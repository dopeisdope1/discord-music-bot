"use strict";

const guildSettingsRepo = require("../../db/repositories/guildSettingsRepo");
const { extractChannelId } = require("../../utils/args");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "leavemessage",
    category: "logs",
    description: "Configure le message de départ.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        if (ctx.args.length === 0) {
            const settings = ctx.settings;
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "👋 Message de départ",
                        fields: [
                            {
                                name: "Salon",
                                value: settings?.leave_channel_id
                                    ? `<#${settings.leave_channel_id}>`
                                    : "Non configuré",
                                inline: true,
                            },
                            {
                                name: "Message",
                                value: settings?.leave_message || "Non configuré",
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
        if (!channelId) throw new UsageError("leavemessage #salon <texte avec {user} {server} {count}>");

        const text = ctx.args.slice(1).join(" ");
        if (!text) throw new UsageError("leavemessage #salon <texte avec {user} {server} {count}>");

        guildSettingsRepo.setField(ctx.guildId, ctx.identity.key, "leave_channel_id", channelId);
        guildSettingsRepo.setField(ctx.guildId, ctx.identity.key, "leave_message", text);

        await ctx.reply(`✅ Message de départ configuré sur <#${channelId}>.`);
    },
};
