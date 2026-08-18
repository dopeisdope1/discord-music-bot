"use strict";

const snipeCache = require("../../utils/snipeCache");
const { BotError } = require("../../core/errors");

module.exports = {
    name: "snipe",
    category: "public",
    description: "Récupère le dernier message supprimé du salon.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const snipe = snipeCache.getSnipe(ctx.message.channel.id);
        if (!snipe) throw new BotError("Aucun message supprimé récemment dans ce salon.");

        await ctx.reply({
            embeds: [
                ctx
                    .embed({
                        title: "🗑️ Message supprimé",
                        description: snipe.content?.slice(0, 4096) || "*(pas de contenu texte)*",
                        fields: [
                            {
                                name: "Auteur",
                                value: snipe.authorId ? `<@${snipe.authorId}> (${snipe.authorTag || "inconnu"})` : "Inconnu",
                                inline: true,
                            },
                            { name: "Supprimé", value: `<t:${Math.floor(snipe.deletedAt / 1000)}:R>`, inline: true },
                        ],
                    })
                    .setThumbnail(snipe.authorAvatar || null),
            ],
        });
    },
};
