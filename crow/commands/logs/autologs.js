"use strict";

const { ChannelType } = require("discord.js");
const logsConfigRepo = require("../../db/repositories/logsConfigRepo");
const { LEVEL } = require("../../core/permissions/permissionLevels");

const CATEGORY_NAME = "📁 logs";

const LOG_TYPES = [
    { logType: "moderation", channelName: "mod-logs" },
    { logType: "messages", channelName: "msg-logs" },
    { logType: "raid", channelName: "raid-logs" },
    { logType: "roles", channelName: "role-logs" },
    { logType: "voice", channelName: "voice-logs" },
    { logType: "automod", channelName: "automod-logs" },
    { logType: "embed", channelName: "embed-logs" },
];

module.exports = {
    name: "autologs",
    category: "logs",
    description: "Configure automatiquement tous les salons de logs.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
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

        const lines = [];

        for (const { logType, channelName } of LOG_TYPES) {
            let channel = guild.channels.cache.find(
                (c) =>
                    c.type === ChannelType.GuildText &&
                    c.name === channelName &&
                    c.parentId === category.id
            );
            let created = false;
            if (!channel) {
                channel = await guild.channels.create({
                    name: channelName,
                    type: ChannelType.GuildText,
                    parent: category.id,
                });
                created = true;
            }
            logsConfigRepo.setChannel(ctx.guildId, ctx.identity.key, logType, channel.id);
            lines.push(`${created ? "🆕" : "🔗"} <#${channel.id}> → \`${logType}\``);
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "📁 Configuration automatique des logs",
                    description: lines.join("\n"),
                }),
            ],
        });
    },
};
