"use strict";

const blacklistRepo = require("../../db/repositories/blacklistRepo");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");

// Same DB effect as unbl, but WITHOUT the auto-unban side effect — for
// admins who want to clear the flag without necessarily unbanning the user
// everywhere it may have been applied.
module.exports = {
    name: "forceunbl",
    category: "bl",
    description: "Retire de force un utilisateur de la blacklist.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("forceunbl @user");

        const removed = blacklistRepo.globalRemove(targetId);
        if (!removed) throw new BotError("Cet utilisateur n'est pas dans la blacklist globale.");

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "⛔ Blacklist globale",
                    description: `<@${targetId}> a été retiré de force de la blacklist globale (aucun débannissement automatique n'a été effectué).`,
                }),
            ],
        });
    },
};
