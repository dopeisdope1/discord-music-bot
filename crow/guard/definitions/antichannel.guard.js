"use strict";

const { AuditLogEvent, Events } = require("discord.js");
const { resolveExecutor } = require("../auditLogWatcher");
const moderationService = require("../../services/moderationService");
const { resolvePermission } = require("../../core/permissions/resolvePermission");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

module.exports = {
    key: "antichannel",
    discordEvent: Events.ChannelCreate,
    async matcher(channel) {
        if (!channel.guild) return null;
        return {
            guildId: channel.guild.id,
            client: channel.client,
            channel,
            description: `Salon créé : #${channel.name}`,
        };
    },
    async condition(ctx) {
        const { match, identity } = ctx;
        const guild = match.channel.guild;

        const executor = await resolveExecutor(guild, AuditLogEvent.ChannelCreate, match.channel.id);
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
        await match.channel.delete("Garde antichannel: création non autorisée").catch(() => {});

        if (ctx.executorId) {
            await moderationService
                .applyGuardPunition({
                    guild: match.channel.guild,
                    target: { id: ctx.executorId },
                    identityKey: ctx.identity.key,
                    punition: ctx.config.punition,
                    reason: "Garde antichannel: a créé un salon non autorisé",
                })
                .catch(() => {});
        }
    },
};
