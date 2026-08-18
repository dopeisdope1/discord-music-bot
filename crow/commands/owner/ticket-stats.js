"use strict";

const ticketRepo = require("../../db/repositories/ticketRepo");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "ticket-stats",
    category: "owner",
    description: "Affiche les statistiques des tickets.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const stats = ticketRepo.stats(ctx.guildId);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🎫 Statistiques des tickets",
                    fields: [
                        { name: "Total", value: `${stats.total}`, inline: true },
                        { name: "Ouverts", value: `${stats.open}`, inline: true },
                        { name: "Fermés", value: `${stats.closed}`, inline: true },
                    ],
                }),
            ],
        });
    },
};
