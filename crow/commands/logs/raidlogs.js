"use strict";

const logsConfigRepo = require("../../db/repositories/logsConfigRepo");
const { extractChannelId } = require("../../utils/args");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "raidlogs",
    category: "logs",
    description: "Définit le salon des logs d'antiraid.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const channelId = extractChannelId(ctx.args[0]);
        if (!channelId) throw new UsageError("raidlogs #salon");
        // logType "raid" is exactly what logsConfigRepo.postGuardLog looks for
        // first — wiring this correctly is what makes antiraid guard logs post.
        logsConfigRepo.setChannel(ctx.guildId, ctx.identity.key, "raid", channelId);
        await ctx.reply(`✅ Salon de logs d'antiraid défini sur <#${channelId}>.`);
    },
};
