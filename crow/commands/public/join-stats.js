"use strict";

const DAY_MS = 86_400_000;

module.exports = {
    name: "join-stats",
    category: "public",
    description: "Affiche les statistiques des arrivées de membres.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        await ctx.guild.members.fetch();

        const now = Date.now();
        const members = [...ctx.guild.members.cache.values()];

        const countSince = (ms) => members.filter((m) => m.joinedTimestamp && now - m.joinedTimestamp <= ms).length;

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "📈 Statistiques des arrivées",
                    fields: [
                        { name: "Dernières 24h", value: `${countSince(DAY_MS)}`, inline: true },
                        { name: "Derniers 7 jours", value: `${countSince(7 * DAY_MS)}`, inline: true },
                        { name: "Derniers 30 jours", value: `${countSince(30 * DAY_MS)}`, inline: true },
                        { name: "Total des membres", value: `${ctx.guild.memberCount}`, inline: false },
                    ],
                }),
            ],
        });
    },
};
