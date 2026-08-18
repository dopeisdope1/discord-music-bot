"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractChannelId } = require("../../utils/args");

module.exports = {
    name: "embed",
    category: "gestion",
    description: "Lance l'éditeur d'embeds interactif.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        if (ctx.args.length < 2) throw new UsageError("embed #salon Titre | Description");

        const channelId = extractChannelId(ctx.args[0]);
        if (!channelId) throw new UsageError("embed #salon Titre | Description");

        const channel = ctx.guild.channels.cache.get(channelId);
        if (!channel || !channel.isTextBased?.()) {
            throw new BotError("Salon textuel introuvable.");
        }

        const rest = ctx.args.slice(1).join(" ");
        const pipeIndex = rest.indexOf("|");
        if (pipeIndex === -1) throw new UsageError("embed #salon Titre | Description");

        const title = rest.slice(0, pipeIndex).trim();
        const description = rest.slice(pipeIndex + 1).trim();
        if (!title || !description) throw new UsageError("embed #salon Titre | Description");

        try {
            await channel.send({ embeds: [ctx.embed({ title, description })] });
        } catch (error) {
            throw new BotError(`Impossible d'envoyer l'embed : ${error.message}`);
        }

        await ctx.reply(`✅ Embed envoyé dans ${channel}.`);
    },
};
