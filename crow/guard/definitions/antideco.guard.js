"use strict";

const { AuditLogEvent, Events } = require("discord.js");
const { resolveExecutor } = require("../auditLogWatcher");
const moderationService = require("../../services/moderationService");
const { resolvePermission } = require("../../core/permissions/resolvePermission");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

module.exports = {
    key: "antideco",
    discordEvent: Events.VoiceStateUpdate,
    async matcher(oldState, newState) {
        if (!oldState.channelId || newState.channelId) return null; // only a full disconnect
        return {
            guildId: oldState.guild.id,
            client: oldState.client,
            member: oldState.member,
            description: `${oldState.member?.user?.tag ?? oldState.id} déconnecté du vocal`,
        };
    },
    async condition(ctx) {
        const { match, identity } = ctx;
        if (!match.member) return true;
        const guild = match.member.guild;

        // Discord's MemberDisconnect audit entry can cover multiple members at
        // once (mass-disconnect action) and doesn't carry a per-member targetId
        // the way role/ban entries do — this resolves the most recent matching
        // entry as a best-effort attribution, not a guaranteed 1:1 match.
        const executor = await resolveExecutor(guild, AuditLogEvent.MemberDisconnect, null);
        if (!executor) return true; // voluntary disconnects leave no audit entry -> fail open

        ctx.executorId = executor.executorId;
        if (executor.executorId === guild.client.user.id) return true;
        if (executor.executorId === guild.ownerId) return true;
        if (guardConfigRepo.isWhitelisted(match.guildId, identity.key, executor.executorId, [])) return true;

        const executorMember = await guild.members.fetch(executor.executorId).catch(() => null);
        if (executorMember && resolvePermission(executorMember) >= LEVEL.ADMIN) return true;

        return false;
    },
    async punish(ctx) {
        if (ctx.executorId) {
            await moderationService
                .applyGuardPunition({
                    guild: ctx.match.member.guild,
                    target: { id: ctx.executorId },
                    identityKey: ctx.identity.key,
                    punition: ctx.config.punition,
                    reason: "Garde antideco: déconnexion vocale non autorisée",
                })
                .catch(() => {});
        }
    },
};
