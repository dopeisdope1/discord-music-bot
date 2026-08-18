"use strict";

const giveawayRepo = require("../../db/repositories/giveawayRepo");
const giveawayService = require("../../services/giveawayService");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "gend",
    category: "giveaway",
    description: "Force la fin immédiate d'un concours.",
    permLevel: LEVEL.STAFF,
    aliases: [],
    async execute(ctx) {
        const id = Number(ctx.args[0]);
        if (!Number.isInteger(id) || id <= 0) throw new UsageError("gend [ID]");

        const giveaway = giveawayRepo.getById(id);
        if (!giveaway || giveaway.ended || giveaway.guild_id !== ctx.guildId) {
            throw new BotError("Giveaway introuvable ou déjà terminé.");
        }

        await giveawayService.endGiveaway(ctx.client, giveaway);

        await ctx.reply(`✅ Giveaway #${id} terminé.`);
    },
};
