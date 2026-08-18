"use strict";

const { BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "nsfw",
    category: "gestion",
    description: "Bascule le filtre NSFW sur le salon actuel.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const channel = ctx.message.channel;
        const next = !channel.nsfw;

        try {
            await channel.setNSFW(next);
        } catch (error) {
            throw new BotError(`Impossible de modifier le filtre NSFW : ${error.message}`);
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔞 Filtre NSFW",
                    description: next
                        ? "Ce salon est désormais marqué NSFW."
                        : "Ce salon n'est plus marqué NSFW.",
                }),
            ],
        });
    },
};
