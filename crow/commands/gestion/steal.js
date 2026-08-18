"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

const EMOJI_TOKEN = /<(a?):(\w+):(\d+)>/;

module.exports = {
    name: "steal",
    category: "gestion",
    description: "Ajoute un emoji externe à votre serveur.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const match = (ctx.args[0] || "").match(EMOJI_TOKEN);
        if (!match) throw new UsageError("steal <emoji_custom>");

        const [, animatedFlag, name, id] = match;
        const url = `https://cdn.discordapp.com/emojis/${id}.${animatedFlag ? "gif" : "png"}`;

        let emoji;
        try {
            emoji = await ctx.guild.emojis.create({ attachment: url, name });
        } catch (error) {
            throw new BotError(`Impossible d'ajouter l'emoji : ${error.message}`);
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "😀 Emoji ajouté",
                    description: `${emoji} a été ajouté sous le nom **${emoji.name}**.`,
                }),
            ],
        });
    },
};
