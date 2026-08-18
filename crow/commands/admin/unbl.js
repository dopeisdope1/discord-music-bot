"use strict";

const blacklistRepo = require("../../db/repositories/blacklistRepo");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");

module.exports = {
    name: "unbl",
    category: "admin",
    description: "Retire un utilisateur de la blacklist.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("unbl @user");

        const removed = blacklistRepo.guildRemove(ctx.guildId, targetId);
        if (!removed) throw new BotError("Cet utilisateur n'est pas dans la liste noire.");

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "✅ Blacklist",
                    description: `<@${targetId}> a été retiré de la liste noire.`,
                }),
            ],
        });
    },
};
