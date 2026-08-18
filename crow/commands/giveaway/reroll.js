"use strict";

const giveawayRepo = require("../../db/repositories/giveawayRepo");
const giveawayService = require("../../services/giveawayService");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "reroll",
    category: "giveaway",
    description: "Relance le tirage pour désigner un nouveau gagnant.",
    permLevel: LEVEL.STAFF,
    aliases: [],
    async execute(ctx) {
        const id = Number(ctx.args[0]);
        if (!Number.isInteger(id) || id <= 0) throw new UsageError("reroll [ID]");

        const giveaway = giveawayRepo.getById(id);
        if (!giveaway || giveaway.guild_id !== ctx.guildId) {
            throw new BotError("Giveaway introuvable.");
        }

        const entries = giveawayRepo.listEntries(id);
        const [winner] = giveawayService.pickWinners(entries, 1);

        if (!winner) {
            await ctx.reply("❌ Aucun participant disponible pour un nouveau tirage.");
            return;
        }

        const embed = ctx.embed({
            title: "🔁 Nouveau gagnant !",
            description: `Nouveau gagnant pour **${giveaway.prize}** : <@${winner}> !`,
        });

        const channel = await ctx.client.channels.fetch(giveaway.channel_id).catch(() => null);
        if (channel?.isTextBased?.()) {
            await channel.send({ content: `🔁 Nouveau gagnant : <@${winner}>`, embeds: [embed] }).catch(() => {});
        } else {
            await ctx.reply({ embeds: [embed] });
        }
    },
};
