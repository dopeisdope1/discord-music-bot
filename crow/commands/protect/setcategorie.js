"use strict";

const { ChannelType } = require("discord.js");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const logsConfigRepo = require("../../db/repositories/logsConfigRepo");

const CATEGORY_NAME = "🛡️ CrowPROTECT";
const CHANNEL_NAME = "protect-logs";

module.exports = {
    name: "setcategorie",
    category: "protect",
    description: "Crée automatiquement la catégorie et les salons de logs.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const guild = ctx.guild;

        let category = guild.channels.cache.find(
            (c) => c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME
        );
        if (!category) {
            category = await guild.channels.create({
                name: CATEGORY_NAME,
                type: ChannelType.GuildCategory,
            });
        }

        let channel = guild.channels.cache.find(
            (c) => c.type === ChannelType.GuildText && c.name === CHANNEL_NAME && c.parentId === category.id
        );
        let created = false;
        if (!channel) {
            channel = await guild.channels.create({
                name: CHANNEL_NAME,
                type: ChannelType.GuildText,
                parent: category.id,
            });
            created = true;
        }

        // "raid" is what the guard engine's default log poster looks for first,
        // "general" is the fallback used for anything else.
        logsConfigRepo.setChannel(ctx.guildId, ctx.identity.key, "raid", channel.id);
        logsConfigRepo.setChannel(ctx.guildId, ctx.identity.key, "general", channel.id);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🛡️ Configuration CrowPROTECT",
                    description: `${created ? "🆕" : "🔗"} Catégorie **${CATEGORY_NAME}** et salon <#${channel.id}> configurés pour les logs.`,
                }),
            ],
        });
    },
};
