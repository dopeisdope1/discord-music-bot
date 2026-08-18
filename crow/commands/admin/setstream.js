"use strict";

const { ActivityType } = require("discord.js");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "setstream",
    category: "admin",
    description: "Définit le statut stream du bot.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const url = ctx.args[0];
        if (!url) throw new UsageError("setstream <url_twitch> [texte]");

        const text = ctx.args.slice(1).join(" ") || "en direct";

        try {
            ctx.client.user.setActivity(text, { type: ActivityType.Streaming, url });
        } catch {
            throw new BotError("Impossible de définir le statut de stream.");
        }

        await ctx.reply({
            embeds: [ctx.embed({ title: "🔴 Statut stream", description: `Statut mis à jour : **${text}**` })],
        });
    },
};
