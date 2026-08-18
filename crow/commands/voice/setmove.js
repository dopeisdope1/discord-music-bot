"use strict";

const voiceRepo = require("../../db/repositories/voiceRepo");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractChannelId } = require("../../utils/args");

module.exports = {
    name: "setmove",
    category: "voice",
    description: "Configure le salon de déplacement (lock/pv).",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const channelId = extractChannelId(ctx.args[0]);
        if (!channelId) throw new UsageError("setmove #salon");

        voiceRepo.setConfigField(ctx.guildId, "move_channel_id", channelId);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "📌 Salon de déplacement",
                    description: `Le salon de déplacement est désormais <#${channelId}>.`,
                }),
            ],
        });
    },
};
