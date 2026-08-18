"use strict";

const { ActivityType } = require("discord.js");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "play",
    category: "admin",
    description: "Définit le statut Joue à du bot.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const text = ctx.args.join(" ").trim();
        if (!text) throw new UsageError("play [activité]");

        try {
            ctx.client.user.setActivity(text, { type: ActivityType.Playing });
        } catch {
            throw new BotError("Impossible de définir l'activité.");
        }

        await ctx.reply({
            embeds: [ctx.embed({ title: "🎮 Statut", description: `Statut défini : **Joue à ${text}**.` })],
        });
    },
};
