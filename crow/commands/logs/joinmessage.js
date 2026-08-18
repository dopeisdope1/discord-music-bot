"use strict";

const guildSettingsRepo = require("../../db/repositories/guildSettingsRepo");
const { extractChannelId } = require("../../utils/args");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "joinmessage",
    category: "logs",
    description: "Configure le message d'accueil.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        if (ctx.args.length === 0) {
            const settings = ctx.settings;
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "👋 Message d'accueil",
                        fields: [
                            {
                                name: "Salon",
                                value: settings?.join_channel_id
                                    ? `<#${settings.join_channel_id}>`
                                    : "Non configuré",
                                inline: true,
                            },
                            {
                                name: "Message",
                                value: settings?.join_message || "Non configuré",
                                inline: false,
                            },
                        ],
                        footer: "Placeholders : {user} {server} {count}",
                    }),
                ],
            });
            return;
        }

        const channelId = extractChannelId(ctx.args[0]);
        if (!channelId) throw new UsageError("joinmessage #salon <texte avec {user} {server} {count}>");

        const text = ctx.args.slice(1).join(" ");
        if (!text) throw new UsageError("joinmessage #salon <texte avec {user} {server} {count}>");

        guildSettingsRepo.setField(ctx.guildId, ctx.identity.key, "join_channel_id", channelId);
        guildSettingsRepo.setField(ctx.guildId, ctx.identity.key, "join_message", text);

        await ctx.reply(`✅ Message d'accueil configuré sur <#${channelId}>.`);
    },
};
