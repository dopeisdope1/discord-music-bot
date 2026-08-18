"use strict";

const logsConfigRepo = require("../../db/repositories/logsConfigRepo");
const { extractChannelId } = require("../../utils/args");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "embedlogs",
    category: "logs",
    description: "Définit le salon des logs des embeds.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const channelId = extractChannelId(ctx.args[0]);
        if (!channelId) throw new UsageError("embedlogs #salon");
        logsConfigRepo.setChannel(ctx.guildId, ctx.identity.key, "embed", channelId);
        await ctx.reply(`✅ Salon de logs des embeds défini sur <#${channelId}>.`);
    },
};
