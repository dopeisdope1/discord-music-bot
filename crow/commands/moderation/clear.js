"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "clear",
    category: "moderation",
    description: "Supprime un nombre défini de messages.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const n = Number(ctx.args[0]);
        if (!Number.isInteger(n) || n < 1 || n > 100) throw new UsageError("clear [1-100]");

        const deleted = await ctx.message.channel.bulkDelete(n, true).catch(() => null);
        if (!deleted) {
            throw new BotError("Impossible de supprimer les messages (permissions ou messages trop anciens).");
        }

        const confirmation = await ctx.send(`🧹 ${deleted.size} message(s) supprimé(s).`);
        if (confirmation) {
            setTimeout(() => confirmation.delete().catch(() => {}), 5000);
        }
    },
};
