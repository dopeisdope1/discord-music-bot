"use strict";

const voiceRepo = require("../../db/repositories/voiceRepo");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");

module.exports = {
    name: "unblv",
    category: "voice",
    description: "Retire la blacklist vocale d'un salon.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("unblv @user");

        const removed = voiceRepo.unban(ctx.guildId, targetId);
        if (!removed) throw new BotError("Ce membre n'est pas blacklisté vocalement.");

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "✅ Blacklist retirée",
                    description: `<@${targetId}> peut de nouveau utiliser les salons vocaux.`,
                }),
            ],
        });
    },
};
