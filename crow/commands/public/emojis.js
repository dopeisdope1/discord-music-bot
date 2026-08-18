"use strict";

const { paginate } = require("../../utils/pagination");
const { BotError } = require("../../core/errors");

const PAGE_SIZE = 30;

module.exports = {
    name: "emojis",
    category: "public",
    description: "Affiche la liste de tous les emojis du serveur.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const emojis = [...ctx.guild.emojis.cache.values()];
        if (!emojis.length) throw new BotError("Ce serveur n'a aucun emoji personnalisé.");

        const chunks = [];
        for (let i = 0; i < emojis.length; i += PAGE_SIZE) {
            chunks.push(emojis.slice(i, i + PAGE_SIZE));
        }

        const pages = chunks.map((chunk, pageIndex) =>
            ctx.embed({
                title: `😀 Emojis du serveur (${emojis.length}) — page ${pageIndex + 1}/${chunks.length}`,
                description: chunk.map((e) => e.toString()).join(" "),
            })
        );

        await paginate(ctx.message, pages);
    },
};
