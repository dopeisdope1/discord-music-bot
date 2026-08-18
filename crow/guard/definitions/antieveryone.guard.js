"use strict";

const { Events } = require("discord.js");
const moderationService = require("../../services/moderationService");
const { resolvePermission } = require("../../core/permissions/resolvePermission");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

// No audit-log lookup needed here — the actor IS the message author.
module.exports = {
    key: "antieveryone",
    discordEvent: Events.MessageCreate,
    async matcher(message) {
        if (!message.guild || message.author.bot) return null;
        if (!message.mentions.everyone) return null;
        return {
            guildId: message.guild.id,
            client: message.client,
            message,
            description: `@everyone/@here utilisé par ${message.author.tag}`,
        };
    },
    async condition(ctx) {
        const { match, identity } = ctx;
        ctx.executorId = match.message.author.id;

        if (guardConfigRepo.isWhitelisted(match.guildId, identity.key, ctx.executorId, [])) return true;

        const member = match.message.member;
        if (member && resolvePermission(member) >= LEVEL.ADMIN) return true;

        return false;
    },
    async punish(ctx) {
        const { match } = ctx;
        await match.message.delete().catch(() => {});

        await moderationService
            .applyGuardPunition({
                guild: match.message.guild,
                target: { id: ctx.executorId },
                identityKey: ctx.identity.key,
                punition: ctx.config.punition,
                reason: "Garde antieveryone: mention @everyone/@here non autorisée",
            })
            .catch(() => {});
    },
};
