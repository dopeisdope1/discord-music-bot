"use strict";

const { ChannelType } = require("discord.js");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "create",
    category: "gestion",
    description: "Crée un salon textuel rapide.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const name = ctx.args.join(" ").trim();
        if (!name) throw new UsageError("create [nom]");

        let channel;
        try {
            channel = await ctx.guild.channels.create({
                name,
                type: ChannelType.GuildText,
                parent: ctx.message.channel.parentId ?? undefined,
            });
        } catch (error) {
            throw new BotError(`Impossible de créer le salon : ${error.message}`);
        }

        await ctx.reply({
            embeds: [ctx.embed({ title: "💬 Salon créé", description: `${channel} a été créé.` })],
        });
    },
};
