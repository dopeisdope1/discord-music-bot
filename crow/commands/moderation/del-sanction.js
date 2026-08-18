"use strict";

const sanctionsRepo = require("../../db/repositories/sanctionsRepo");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "del-sanction",
    category: "moderation",
    description: "Supprime une sanction donnée.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const id = Number(ctx.args[0]);
        if (!Number.isInteger(id) || id <= 0) throw new UsageError("del-sanction [ID]");

        const removed = sanctionsRepo.remove(ctx.guildId, id);
        if (!removed) throw new BotError("Sanction introuvable.");

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🗑️ Sanction supprimée",
                    description: `La sanction #${id} a été supprimée.`,
                }),
            ],
        });
    },
};
