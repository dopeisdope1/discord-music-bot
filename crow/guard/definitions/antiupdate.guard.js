"use strict";

const { AuditLogEvent, Events } = require("discord.js");
const { resolveExecutor } = require("../auditLogWatcher");
const moderationService = require("../../services/moderationService");
const { resolvePermission } = require("../../core/permissions/resolvePermission");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

// Catches privilege escalation via editing an EXISTING role's permissions.
// Creating a brand-new role is a separate concern (handled elsewhere), not this guard.
module.exports = {
    key: "antiupdate",
    discordEvent: Events.GuildRoleUpdate,
    async matcher(oldRole, newRole) {
        if (oldRole.permissions.bitfield === newRole.permissions.bitfield) return null;
        return {
            guildId: newRole.guild.id,
            client: newRole.client,
            role: newRole,
            oldPermissions: oldRole.permissions,
            description: `Permissions du rôle @${newRole.name} modifiées`,
        };
    },
    async condition(ctx) {
        const { match, identity } = ctx;
        const guild = match.role.guild;

        const executor = await resolveExecutor(guild, AuditLogEvent.RoleUpdate, match.role.id);
        if (!executor) return true; // no attributable actor -> fail open, never punish blind

        ctx.executorId = executor.executorId;
        if (executor.executorId === guild.client.user.id) return true;
        if (executor.executorId === guild.ownerId) return true;
        if (guardConfigRepo.isWhitelisted(match.guildId, identity.key, executor.executorId, [])) return true;

        const executorMember = await guild.members.fetch(executor.executorId).catch(() => null);
        if (executorMember && resolvePermission(executorMember) >= LEVEL.ADMIN) return true;

        return false;
    },
    async punish(ctx) {
        const { match } = ctx;
        await match.role
            .setPermissions(match.oldPermissions, "Garde antiupdate: modification non autorisée")
            .catch(() => {});

        if (ctx.executorId) {
            await moderationService
                .applyGuardPunition({
                    guild: match.role.guild,
                    target: { id: ctx.executorId },
                    identityKey: ctx.identity.key,
                    punition: ctx.config.punition,
                    reason: "Garde antiupdate: modification de permissions non autorisée",
                })
                .catch(() => {});
        }
    },
};
