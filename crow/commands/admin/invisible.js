"use strict";

const { BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "invisible",
    category: "admin",
    description: "Définit le statut du bot sur Invisible.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        try {
            ctx.client.user.setStatus("invisible");
        } catch {
            throw new BotError("Impossible de changer le statut du bot.");
        }

        await ctx.reply({
            embeds: [ctx.embed({ title: "⚪ Statut", description: "Statut défini sur **Invisible**." })],
        });
    },
};
