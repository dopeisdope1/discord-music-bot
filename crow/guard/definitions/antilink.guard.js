"use strict";

const { Events } = require("discord.js");
const moderationService = require("../../services/moderationService");
const { resolvePermission } = require("../../core/permissions/resolvePermission");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

const LINK_PATTERN = /https?:\/\/\S+|discord(?:\.gg|app\.com\/invite|\.com\/invite)\/\S+/i;

// No audit-log lookup needed here — the actor IS the message author, same shape
// as antieveryone.guard.js.
module.exports = {
    key: "antilink",
    discordEvent: Events.MessageCreate,
    async matcher(message) {
        if (!message.guild || message.author.bot) return null;
        if (!LINK_PATTERN.test(message.content)) return null;
        return {
            guildId: message.guild.id,
            client: message.client,
            message,
            description: `Lien posté par ${message.author.tag}`,
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
                reason: "Garde antilink: lien non autorisé",
            })
            .catch(() => {});
    },
};
