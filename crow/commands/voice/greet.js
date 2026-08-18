"use strict";

const voiceRepo = require("../../db/repositories/voiceRepo");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractChannelId } = require("../../utils/args");

module.exports = {
    name: "greet",
    category: "voice",
    description: "Configure le salon de bienvenue.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const channelId = extractChannelId(ctx.args[0]);
        if (!channelId) throw new UsageError("greet #salon");

        voiceRepo.setConfigField(ctx.guildId, "greet_channel_id", channelId);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "👋 Salon de bienvenue",
                    description: `Le salon de bienvenue est désormais <#${channelId}>.`,
                }),
            ],
        });
    },
};
