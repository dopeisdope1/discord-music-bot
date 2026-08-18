"use strict";

const moderationService = require("../../services/moderationService");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");
const { parseDuration, formatDuration } = require("../../utils/time");

module.exports = {
    name: "tempban",
    category: "moderation",
    description: "Bannit temporairement un membre.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("tempban @user [temps] [raison]");

        const user = await ctx.client.users.fetch(targetId).catch(() => null);
        if (!user) throw new BotError("Utilisateur introuvable.");

        const durationMs = parseDuration(ctx.args[1]);
        if (!durationMs) throw new UsageError("tempban @user [temps] [raison] (ex: 10m, 2h, 1d)");

        const reason = ctx.args.slice(2).join(" ") || null;

        const id = await moderationService.ban({
            guild: ctx.guild,
            target: user,
            moderator: ctx.author,
            identityKey: ctx.identity.key,
            reason,
            durationMs,
        });

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔨 Bannissement temporaire",
                    description: `${user.tag} (${user.id}) a été banni pour ${formatDuration(durationMs)}.`,
                    fields: [
                        { name: "Sanction", value: `#${id}`, inline: true },
                        { name: "Raison", value: reason || "Aucune raison fournie", inline: true },
                    ],
                }),
            ],
        });
    },
};
