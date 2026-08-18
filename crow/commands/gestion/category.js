"use strict";

const { ChannelType } = require("discord.js");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "category",
    category: "gestion",
    description: "Crée une catégorie de salons.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const name = ctx.args.join(" ").trim();
        if (!name) throw new UsageError("category [nom]");

        let category;
        try {
            category = await ctx.guild.channels.create({ name, type: ChannelType.GuildCategory });
        } catch (error) {
            throw new BotError(`Impossible de créer la catégorie : ${error.message}`);
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "📁 Catégorie créée",
                    description: `La catégorie **${category.name}** a été créée.`,
                }),
            ],
        });
    },
};
