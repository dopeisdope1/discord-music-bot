"use strict";

const logsConfigRepo = require("../../db/repositories/logsConfigRepo");
const { extractChannelId } = require("../../utils/args");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "rolelogs",
    category: "logs",
    description: "Définit le salon des logs d'attribution de rôles.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const channelId = extractChannelId(ctx.args[0]);
        if (!channelId) throw new UsageError("rolelogs #salon");
        logsConfigRepo.setChannel(ctx.guildId, ctx.identity.key, "roles", channelId);
        await ctx.reply(`✅ Salon de logs de rôles défini sur <#${channelId}>.`);
    },
};
