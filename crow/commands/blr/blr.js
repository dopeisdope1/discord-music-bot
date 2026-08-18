"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const { UsageError } = require("../../core/errors");
const { extractUserId } = require("../../utils/args");
const blacklistRepo = require("../../db/repositories/blacklistRepo");

module.exports = {
    name: "blr",
    category: "blr",
    description: "Ajoute ou retire un utilisateur de la BLR.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const userId = extractUserId(ctx.args[0]);
        if (!userId) throw new UsageError("blr @utilisateur");

        const blacklisted = blacklistRepo.roleBlacklistToggle(ctx.guildId, userId, ctx.author.id);
        await ctx.reply(
            blacklisted
                ? `✅ <@${userId}> a été ajouté à la BLR (blacklist rôle).`
                : `❌ <@${userId}> a été retiré de la BLR (blacklist rôle).`
        );
    },
};
