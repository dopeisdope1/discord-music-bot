"use strict";

const { AuditLogEvent, Events } = require("discord.js");
const { resolveExecutor } = require("../auditLogWatcher");
const moderationService = require("../../services/moderationService");
const { resolvePermission } = require("../../core/permissions/resolvePermission");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

module.exports = {
    key: "antiwebhook",
    discordEvent: Events.WebhooksUpdate, // fires on any create/update/delete in the channel
    async matcher(channel) {
        if (!channel.guild) return null;
        return {
            guildId: channel.guild.id,
            client: channel.client,
            channel,
            description: `Webhook modifié dans #${channel.name}`,
        };
    },
    async condition(ctx) {
        const { match, identity } = ctx;
        const guild = match.channel.guild;

        const executor = await resolveExecutor(guild, AuditLogEvent.WebhookCreate, null);
        if (!executor) return true; // could be an update/delete, not a creation -> fail open

        ctx.executorId = executor.executorId;
        ctx.webhookId = executor.entry?.targetId;

        if (executor.executorId === guild.client.user.id) return true;
        if (executor.executorId === guild.ownerId) return true;
        if (guardConfigRepo.isWhitelisted(match.guildId, identity.key, executor.executorId, [])) return true;

        const executorMember = await guild.members.fetch(executor.executorId).catch(() => null);
        if (executorMember && resolvePermission(executorMember) >= LEVEL.ADMIN) return true;

        return false;
    },
    async punish(ctx) {
        if (ctx.webhookId) {
            const webhooks = await ctx.match.channel.fetchWebhooks().catch(() => null);
            const hook = webhooks?.get(ctx.webhookId);
            await hook?.delete("Garde antiwebhook: création non autorisée").catch(() => {});
        }

        if (ctx.executorId) {
            await moderationService
                .applyGuardPunition({
                    guild: ctx.match.channel.guild,
                    target: { id: ctx.executorId },
                    identityKey: ctx.identity.key,
                    punition: ctx.config.punition,
                    reason: "Garde antiwebhook: création de webhook non autorisée",
                })
                .catch(() => {});
        }
    },
};
