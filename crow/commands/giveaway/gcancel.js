"use strict";

const giveawayRepo = require("../../db/repositories/giveawayRepo");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "gcancel",
    category: "giveaway",
    description: "Annule un concours en cours.",
    permLevel: LEVEL.STAFF,
    aliases: [],
    async execute(ctx) {
        const id = Number(ctx.args[0]);
        if (!Number.isInteger(id) || id <= 0) throw new UsageError("gcancel [ID]");

        const giveaway = giveawayRepo.getById(id);
        if (!giveaway || giveaway.ended || giveaway.guild_id !== ctx.guildId) {
            throw new BotError("Giveaway introuvable ou déjà terminé.");
        }

        giveawayRepo.markEnded(id);

        if (giveaway.message_id) {
            const channel = await ctx.client.channels.fetch(giveaway.channel_id).catch(() => null);
            if (channel?.isTextBased?.()) {
                const message = await channel.messages.fetch(giveaway.message_id).catch(() => null);
                await message
                    ?.edit({
                        embeds: [
                            ctx.embed({
                                title: "🚫 Giveaway annulé",
                                description: `Le concours pour **${giveaway.prize}** a été annulé.`,
                            }),
                        ],
                        components: [],
                    })
                    .catch(() => {});
            }
        }

        await ctx.reply(`✅ Giveaway #${id} annulé.`);
    },
};
