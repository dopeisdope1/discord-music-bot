"use strict";

const moderationService = require("../../services/moderationService");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");

module.exports = {
    name: "unmute",
    category: "moderation",
    description: "Démute un membre.",
    permLevel: LEVEL.STAFF,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("unmute @user");

        const target = await ctx.guild.members.fetch(targetId).catch(() => null);
        if (!target) throw new BotError("Membre introuvable sur ce serveur.");

        const reason = ctx.args.slice(1).join(" ") || null;

        // If the target is leashed with anti-unmute active, moderationService
        // throws a BotError — let it propagate naturally, messageRouter formats it.
        await moderationService.unmute({
            guild: ctx.guild,
            target,
            moderator: ctx.author,
            identityKey: ctx.identity.key,
            reason,
        });

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔊 Unmute",
                    description: `${target} a été démuté.`,
                }),
            ],
        });
    },
};
