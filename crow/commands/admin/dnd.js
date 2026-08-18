"use strict";

const { BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "dnd",
    category: "admin",
    description: "Définit le statut du bot sur Ne pas déranger.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        try {
            ctx.client.user.setStatus("dnd");
        } catch {
            throw new BotError("Impossible de changer le statut du bot.");
        }

        await ctx.reply({
            embeds: [ctx.embed({ title: "⛔ Statut", description: "Statut défini sur **Ne pas déranger**." })],
        });
    },
};
