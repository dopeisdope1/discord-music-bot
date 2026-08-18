"use strict";

const { BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "serverpic",
    category: "owner",
    description: "Change l'icône du serveur Discord.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const url = ctx.args[0] || null;

        try {
            await ctx.guild.setIcon(url);
        } catch {
            throw new BotError("Impossible de changer l'icône (URL invalide ou permissions insuffisantes).");
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🖼️ Icône du serveur",
                    description: url ? "L'icône du serveur a été mise à jour." : "L'icône du serveur a été retirée.",
                }),
            ],
        });
    },
};
