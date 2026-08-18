"use strict";

const blacklistRepo = require("../../db/repositories/blacklistRepo");
const moderationService = require("../../services/moderationService");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");

module.exports = {
    name: "gunbl",
    category: "bl",
    description: "Retire un utilisateur de la blacklist et le débannit.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("gunbl @user");

        const removed = blacklistRepo.globalRemove(targetId);
        if (!removed) throw new BotError("Cet utilisateur n'est pas dans la blacklist globale.");

        // Best-effort: they might not actually be banned on this specific guild.
        await moderationService
            .unban({ guild: ctx.guild, userId: targetId, reason: "Retiré de la blacklist globale" })
            .catch(() => {});

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "⛔ Blacklist globale",
                    description: `<@${targetId}> a été retiré de la blacklist globale et débanni de ce serveur si nécessaire.`,
                }),
            ],
        });
    },
};
