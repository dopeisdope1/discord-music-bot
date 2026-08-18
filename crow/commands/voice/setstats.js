"use strict";

const voiceRepo = require("../../db/repositories/voiceRepo");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractChannelId } = require("../../utils/args");

module.exports = {
    name: "setstats",
    category: "voice",
    description: "Configure le salon des statistiques vocales.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const channelId = extractChannelId(ctx.args[0]);
        if (!channelId) throw new UsageError("setstats #salon");

        voiceRepo.setConfigField(ctx.guildId, "stats_channel_id", channelId);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "📊 Salon des statistiques",
                    description: `Le salon des statistiques est désormais <#${channelId}>.`,
                }),
            ],
        });
    },
};
