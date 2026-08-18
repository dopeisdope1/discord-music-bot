"use strict";

const { AuditLogEvent, Events } = require("discord.js");
const { resolveExecutor } = require("../auditLogWatcher");
const moderationService = require("../../services/moderationService");
const { resolvePermission } = require("../../core/permissions/resolvePermission");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

module.exports = {
    key: "antiban",
    discordEvent: Events.GuildBanAdd,
    async matcher(ban) {
        return {
            guildId: ban.guild.id,
            client: ban.guild.client,
            ban,
            description: `Bannissement de ${ban.user.tag}`,
        };
    },
    async condition(ctx) {
        const { match, identity } = ctx;
        const guild = match.ban.guild;

        const executor = await resolveExecutor(guild, AuditLogEvent.MemberBanAdd, match.ban.user.id);
        if (!executor) return true;

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
            .unban({ guild: match.ban.guild, userId: match.ban.user.id, reason: "Garde antiban: bannissement non autorisé" })
            .catch(() => {});

        if (ctx.executorId) {
            await moderationService
                .applyGuardPunition({
                    guild: match.ban.guild,
                    target: { id: ctx.executorId },
                    identityKey: ctx.identity.key,
                    punition: ctx.config.punition,
                    reason: "Garde antiban: bannissement non autorisé",
                })
                .catch(() => {});
        }
    },
};
