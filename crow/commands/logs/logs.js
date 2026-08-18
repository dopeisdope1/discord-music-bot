"use strict";

const guildSettingsRepo = require("../../db/repositories/guildSettingsRepo");
const logsConfigRepo = require("../../db/repositories/logsConfigRepo");
const { extractChannelId } = require("../../utils/args");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "logs",
    category: "logs",
    description: "Active/Désactive la configuration globale des logs.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const enabled = ctx.args[0] === "off" ? 0 : 1;
        guildSettingsRepo.setField(ctx.guildId, ctx.identity.key, "logs_master_enabled", enabled);

        const channelId = extractChannelId(ctx.args[0]);
        if (channelId) {
            logsConfigRepo.setChannel(ctx.guildId, ctx.identity.key, "general", channelId);
        }

        await ctx.reply(
            `✅ Logs ${enabled ? "activés" : "désactivés"}.` +
                (channelId ? ` Salon général de logs défini sur <#${channelId}>.` : "")
        );
    },
};
