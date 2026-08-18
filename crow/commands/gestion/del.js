"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractChannelId } = require("../../utils/args");

module.exports = {
    name: "del",
    category: "gestion",
    description: "Supprime un salon textuel spécifique.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const channelId = extractChannelId(ctx.args[0]);
        if (!channelId) throw new UsageError("del [salon]");

        const channel = ctx.guild.channels.cache.get(channelId);
        if (!channel) throw new BotError("Salon introuvable sur ce serveur.");

        const name = channel.name;
        try {
            await channel.delete(`Supprimé par ${ctx.author.tag} via +del`);
        } catch (error) {
            throw new BotError(`Impossible de supprimer ce salon : ${error.message}`);
        }

        await ctx.reply({
            embeds: [
                ctx.embed({ title: "🗑️ Salon supprimé", description: `Le salon **${name}** a été supprimé.` }),
            ],
        });
    },
};
