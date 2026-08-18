"use strict";

const { ActivityType } = require("discord.js");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "watch",
    category: "admin",
    description: "Définit le statut Regarde du bot.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const text = ctx.args.join(" ").trim();
        if (!text) throw new UsageError("watch [activité]");

        try {
            ctx.client.user.setActivity(text, { type: ActivityType.Watching });
        } catch {
            throw new BotError("Impossible de définir l'activité.");
        }

        await ctx.reply({
            embeds: [ctx.embed({ title: "📺 Statut", description: `Statut défini : **Regarde ${text}**.` })],
        });
    },
};
