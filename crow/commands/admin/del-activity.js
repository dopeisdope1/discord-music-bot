"use strict";

const { BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "del-activity",
    category: "admin",
    description: "Supprime l'activité de présence.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        try {
            ctx.client.user.setActivity(null);
        } catch {
            throw new BotError("Impossible de supprimer l'activité.");
        }

        await ctx.reply({
            embeds: [
                ctx.embed({ title: "🧹 Activité supprimée", description: "L'activité de présence a été retirée." }),
            ],
        });
    },
};
