"use strict";

// Near-duplicate of vc.js — the spec lists "vc / voice" as two trigger words
// for the same feature, and command names must be unique per file (aliases
// live in *this* file's own `aliases` array, not cross-file), so this is
// simplest kept as its own tiny file rather than cross-requiring vc.js.
module.exports = {
    name: "voice",
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
