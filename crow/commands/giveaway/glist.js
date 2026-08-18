"use strict";

const giveawayRepo = require("../../db/repositories/giveawayRepo");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { formatDuration } = require("../../utils/time");

module.exports = {
    name: "glist",
    category: "giveaway",
    description: "Affiche la liste des concours actifs.",
    permLevel: LEVEL.NONE,
    aliases: [],
    async execute(ctx) {
        const active = giveawayRepo.listActive(ctx.guildId);

        if (active.length === 0) {
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "🎉 Concours actifs",
                        description: "Aucun concours actif pour le moment.",
                    }),
                ],
            });
            return;
        }

        const fields = active.map((g) => ({
            name: `#${g.id} — ${g.prize}`,
            value: `Gagnants : ${g.winners_count} | Fin dans : ${formatDuration(g.ends_at - Date.now())}`,
            inline: false,
        }));

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🎉 Concours actifs",
                    fields,
                }),
            ],
        });
    },
};
