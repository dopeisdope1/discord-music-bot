"use strict";

const { AuditLogEvent, Events } = require("discord.js");
const { resolveExecutor } = require("../auditLogWatcher");
const moderationService = require("../../services/moderationService");
const { resolvePermission } = require("../../core/permissions/resolvePermission");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");
const logsConfigRepo = require("../../db/repositories/logsConfigRepo");
const { getDb } = require("../../db/connection");

function diffAddedRoles(oldMember, newMember) {
    return [...newMember.roles.cache.keys()].filter((id) => !oldMember.roles.cache.has(id));
}

// Hot-path velocity state: grant timestamps keyed by "guildId:identityKey:executorId:roleId".
// Ephemeral/in-memory on purpose — this is a rate-limit window, not persisted history.
const grantTimestamps = new Map();

module.exports = {
    key: "roleLimit",
    discordEvent: Events.GuildMemberUpdate,
    async matcher(oldMember, newMember) {
        const added = diffAddedRoles(oldMember, newMember);
        if (added.length === 0) return null;
        return {
            guildId: newMember.guild.id,
            client: newMember.client,
            member: newMember,
            addedRoleIds: added,
            description: `Rôle(s) ajouté(s) à ${newMember.user.tag}`,
        };
    },
    async condition(ctx) {
        const { match, identity } = ctx;
        const guild = match.member.guild;
        const db = getDb();

        // Only react to roles actually being watched via `limit @role`.
        const watchedAdded = [];
        for (const roleId of match.addedRoleIds) {
            const limitRow = db
                .prepare(
                    "SELECT * FROM role_limit_config WHERE guild_id = ? AND identity_key = ? AND role_id = ?"
                )
                .get(ctx.guildId, identity.key, roleId);
            if (limitRow) watchedAdded.push({ roleId, limitRow });
        }
        if (watchedAdded.length === 0) return true; // nothing watched, no-op

        const executor = await resolveExecutor(guild, AuditLogEvent.MemberRoleUpdate, match.member.id);
        if (!executor) return true; // no attributable actor -> fail open, never punish blind

        ctx.executorId = executor.executorId;
        if (executor.executorId === guild.client.user.id) return true;
        if (executor.executorId === guild.ownerId) return true;
        if (guardConfigRepo.isWhitelisted(match.guildId, identity.key, executor.executorId, [])) return true;

        const executorMember = await guild.members.fetch(executor.executorId).catch(() => null);
        if (executorMember && resolvePermission(executorMember) >= LEVEL.ADMIN) return true;

        // Velocity check: has this executor granted this watched role too many
        // times within its configured time window?
        let overLimit = false;
        const now = Date.now();
        for (const { roleId, limitRow } of watchedAdded) {
            const mapKey = `${ctx.guildId}:${identity.key}:${executor.executorId}:${roleId}`;
            const timestamps = grantTimestamps.get(mapKey) || [];
            timestamps.push(now);
            const cutoff = now - limitRow.window_ms;
            const pruned = timestamps.filter((t) => t > cutoff);
            grantTimestamps.set(mapKey, pruned);
            if (pruned.length > limitRow.max_per_window) overLimit = true;
        }

        return !overLimit;
    },
    async punish(ctx) {
        const { match } = ctx;
        await moderationService.revertRoleGrant({
            member: match.member,
            roleIds: match.addedRoleIds,
            reason: "Garde roleLimit: attribution en masse détectée",
        });

        if (ctx.executorId && ctx.executorId !== match.member.id) {
            await moderationService
                .applyGuardPunition({
                    guild: match.member.guild,
                    target: { id: ctx.executorId },
                    identityKey: ctx.identity.key,
                    punition: ctx.config.punition,
                    reason: "Garde roleLimit: attribution en masse détectée",
                })
                .catch(() => {});
        }
    },
    async logEvent(ctx) {
        await logsConfigRepo.postLog(ctx.client, ctx.identity, ctx.guildId, "rolelimit", {
            title: "⏱️ Limite de rôle dépassée",
            color: "#ED4245",
            fields: [
                { name: "Membre ciblé", value: `${ctx.match.member} (${ctx.match.member.id})` },
                { name: "Exécutant", value: ctx.executorId ? `<@${ctx.executorId}>` : "Inconnu" },
                { name: "Rôle(s) retiré(s)", value: ctx.match.addedRoleIds.map((id) => `<@&${id}>`).join(", ") },
            ],
        });
    },
};
