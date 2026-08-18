"use strict";

const { AuditLogEvent, Events } = require("discord.js");
const { resolveExecutor } = require("../auditLogWatcher");
const moderationService = require("../../services/moderationService");
const { resolvePermission } = require("../../core/permissions/resolvePermission");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

function diffAddedRoles(oldMember, newMember) {
    return [...newMember.roles.cache.keys()].filter((id) => !oldMember.roles.cache.has(id));
}

// Reference guard: also backs CrowALL/CrowSECUR's `secur` (sensitive-role list is
// just this guard scoped to guard_watched_roles under guard_key "antirole").
module.exports = {
    key: "antirole",
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

        const executor = await resolveExecutor(guild, AuditLogEvent.MemberRoleUpdate, match.member.id);
        if (!executor) return true; // no attributable actor -> fail open, never punish blind

        ctx.executorId = executor.executorId;
        if (executor.executorId === guild.client.user.id) return true;
        if (executor.executorId === guild.ownerId) return true;

        // If specific roles are being watched (e.g. CrowSECUR's `secur add`), only
        // react when one of THOSE roles was granted — otherwise this is a generic
        // antirole guard covering every role grant.
        const watchedRoles = guardConfigRepo.listWatchedRoles(match.guildId, identity.key, "antirole");
        if (watchedRoles.length > 0 && !match.addedRoleIds.some((id) => watchedRoles.includes(id))) {
            return true;
        }

        if (guardConfigRepo.isWhitelisted(match.guildId, identity.key, executor.executorId, [])) return true;

        const executorMember = await guild.members.fetch(executor.executorId).catch(() => null);
        if (executorMember && resolvePermission(executorMember) >= LEVEL.ADMIN) return true;

        return false;
    },
    async punish(ctx) {
        const { match } = ctx;
        await moderationService.revertRoleGrant({
            member: match.member,
            roleIds: match.addedRoleIds,
            reason: "Garde antirole: attribution non autorisée",
        });

        if (ctx.executorId && ctx.executorId !== match.member.id) {
            await moderationService
                .applyGuardPunition({
                    guild: match.member.guild,
                    target: { id: ctx.executorId },
                    identityKey: ctx.identity.key,
                    punition: ctx.config.punition,
                    reason: "Garde antirole: attribution de rôle non autorisée",
                })
                .catch(() => {});
        }
    },
};
