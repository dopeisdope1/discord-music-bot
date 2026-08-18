"use strict";

const logsConfigRepo = require("../../db/repositories/logsConfigRepo");
const { extractChannelId } = require("../../utils/args");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "msglogs",
    category: "logs",
    description: "Définit le salon des logs de messages édités/supprimés.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const channelId = extractChannelId(ctx.args[0]);
        if (!channelId) throw new UsageError("msglogs #salon");
        logsConfigRepo.setChannel(ctx.guildId, ctx.identity.key, "messages", channelId);
        await ctx.reply(`✅ Salon de logs de messages défini sur <#${channelId}>.`);
    },
};
