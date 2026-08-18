"use strict";

const logsConfigRepo = require("../../db/repositories/logsConfigRepo");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractChannelId } = require("../../utils/args");

module.exports = {
    name: "vsetlogs",
    category: "voice",
    description: "Configure le salon des logs.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const channelId = extractChannelId(ctx.args[0]);
        if (!channelId) throw new UsageError("vsetlogs #salon");

        logsConfigRepo.setChannel(ctx.guildId, ctx.identity.key, "voice", channelId);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "📝 Salon de logs",
                    description: `Le salon de logs est désormais <#${channelId}>.`,
                }),
            ],
        });
    },
};
