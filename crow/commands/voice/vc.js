"use strict";

module.exports = {
    name: "vc",
    category: "voice",
    description: "Affiche le nombre de membres en vocal.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const count = [...ctx.guild.channels.cache.values()]
            .filter((c) => c.isVoiceBased())
            .reduce((sum, c) => sum + c.members.size, 0);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔊 Membres en vocal",
                    description: `${count} membre(s) actuellement en vocal.`,
                }),
            ],
        });
    },
};
