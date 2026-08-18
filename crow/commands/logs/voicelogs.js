"use strict";

const logsConfigRepo = require("../../db/repositories/logsConfigRepo");
const { extractChannelId } = require("../../utils/args");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "voicelogs",
    category: "logs",
    description: "Définit le salon des logs de connexions vocales.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const channelId = extractChannelId(ctx.args[0]);
        if (!channelId) throw new UsageError("voicelogs #salon");
        logsConfigRepo.setChannel(ctx.guildId, ctx.identity.key, "voice", channelId);
        await ctx.reply(`✅ Salon de logs vocaux défini sur <#${channelId}>.`);
    },
};
