"use strict";

const { AuditLogEvent, Events } = require("discord.js");
const { resolveExecutor } = require("../auditLogWatcher");
const moderationService = require("../../services/moderationService");
const { resolvePermission } = require("../../core/permissions/resolvePermission");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

module.exports = {
    key: "antiunban",
    discordEvent: Events.GuildBanRemove,
    async matcher(ban) {
        return {
            guildId: ban.guild.id,
            client: ban.guild.client,
            ban,
            description: `Débannissement de ${ban.user.tag}`,
        };
    },
    async condition(ctx) {
        const { match, identity } = ctx;
        const guild = match.ban.guild;

        const executor = await resolveExecutor(guild, AuditLogEvent.MemberBanRemove, match.ban.user.id);
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
        await moderationService
            .ban({
                guild: match.ban.guild,
                target: { id: match.ban.user.id },
                moderator: { id: match.ban.guild.client.user.id },
                identityKey: ctx.identity.key,
                reason: "Garde antiunban: débannissement non autorisé, re-bannissement automatique",
            })
            .catch(() => {});

        if (ctx.executorId) {
            await moderationService
                .applyGuardPunition({
                    guild: match.ban.guild,
                    target: { id: ctx.executorId },
                    identityKey: ctx.identity.key,
                    punition: ctx.config.punition,
                    reason: "Garde antiunban: débannissement non autorisé",
                })
                .catch(() => {});
        }
    },
};
