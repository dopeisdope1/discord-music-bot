"use strict";

const moderationService = require("../../services/moderationService");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");
const { parseDuration, formatDuration } = require("../../utils/time");

module.exports = {
    name: "tempmute",
    category: "moderation",
    description: "Rend muet temporairement un membre.",
    permLevel: LEVEL.STAFF,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("tempmute @user [temps] [raison]");

        const target = await ctx.guild.members.fetch(targetId).catch(() => null);
        if (!target) throw new BotError("Membre introuvable sur ce serveur.");

        const durationMs = parseDuration(ctx.args[1]);
        if (!durationMs) throw new UsageError("tempmute @user [temps] [raison] (ex: 10m, 2h, 1d)");

        const reason = ctx.args.slice(2).join(" ") || null;

        const id = await moderationService.mute({
            guild: ctx.guild,
            target,
            moderator: ctx.author,
            identityKey: ctx.identity.key,
            reason,
            durationMs,
        });

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔇 Mute temporaire",
                    description: `${target} a été rendu muet pour ${formatDuration(durationMs)}.`,
                    fields: [
                        { name: "Sanction", value: `#${id}`, inline: true },
                        { name: "Raison", value: reason || "Aucune raison fournie", inline: true },
                    ],
                }),
            ],
        });
    },
};
