"use strict";

const snipeCache = require("../../utils/snipeCache");
const { BotError } = require("../../core/errors");

module.exports = {
    name: "editsnipe",
    category: "public",
    description: "Affiche le dernier message modifié du salon.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const snipe = snipeCache.getEditSnipe(ctx.message.channel.id);
        if (!snipe) throw new BotError("Aucun message édité récemment dans ce salon.");

        await ctx.reply({
            embeds: [
                ctx
                    .embed({
                        title: "✏️ Message édité",
                        description: snipe.authorId
                            ? `Auteur : <@${snipe.authorId}> (${snipe.authorTag || "inconnu"})`
                            : "Auteur inconnu",
                        fields: [
                            { name: "Avant", value: snipe.before?.slice(0, 1024) || "*(vide)*" },
                            { name: "Après", value: snipe.after?.slice(0, 1024) || "*(vide)*" },
                            { name: "Modifié", value: `<t:${Math.floor(snipe.editedAt / 1000)}:R>` },
                        ],
                    })
                    .setThumbnail(snipe.authorAvatar || null),
            ],
        });
    },
};
