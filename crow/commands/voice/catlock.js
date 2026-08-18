"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractChannelId } = require("../../utils/args");
const { ChannelType } = require("discord.js");

module.exports = {
    name: "catlock",
    category: "voice",
    description: "Bloque ou débloque une catégorie entière.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        let categoryId = extractChannelId(ctx.args[0]);
        if (!categoryId) categoryId = ctx.member.voice.channel?.parentId || null;
        if (!categoryId) throw new UsageError("catlock #categorie");

        const category = ctx.guild.channels.cache.get(categoryId);
        if (!category || category.type !== ChannelType.GuildCategory) {
            throw new BotError("Catégorie introuvable.");
        }

        const voiceChannels = ctx.guild.channels.cache.filter(
            (c) => c.parentId === categoryId && c.isVoiceBased()
        );
        if (!voiceChannels.size) throw new BotError("Aucun salon vocal dans cette catégorie.");

        const everyone = ctx.guild.roles.everyone;
        const currentlyLocked = voiceChannels.first().permissionOverwrites.cache.get(everyone.id)?.deny.has("Connect") ?? false;

        for (const channel of voiceChannels.values()) {
            await channel.permissionOverwrites.edit(everyone, { Connect: currentlyLocked ? null : false });
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: currentlyLocked ? "🔓 Catégorie débloquée" : "🔒 Catégorie bloquée",
                    description: `${voiceChannels.size} salon(s) vocal(aux) mis à jour dans **${category.name}**.`,
                }),
            ],
        });
    },
};
