"use strict";

const logsConfigRepo = require("../../db/repositories/logsConfigRepo");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractChannelId } = require("../../utils/args");

module.exports = {
    name: "setlogs",
    category: "admin",
    description: "Configure le canal de logs.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const channelId = extractChannelId(ctx.args[0]);
        if (!channelId) throw new UsageError("setlogs #salon");

        logsConfigRepo.setChannel(ctx.guildId, ctx.identity.key, "general", channelId);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "📝 Canal de logs",
                    description: `Le canal de logs est désormais <#${channelId}>.`,
                }),
            ],
        });
    },
};
