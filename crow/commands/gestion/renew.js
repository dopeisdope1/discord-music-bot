"use strict";

const { BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

// Implements BOTH original product-spec wordings ("Owner: recreate a channel
// identically" / "Gestion: recreate the current channel fresh & empty") as a
// single command — they describe the same operation: clone the channel
// (name/type/topic/permissionOverwrites/position/parent all copied by
// GuildChannel.clone()), delete the original, confirm in the new one.
module.exports = {
    name: "renew",
    category: "gestion",
    description: "Réinitialise et recrée un salon à l'identique / Recrée le salon actuel à neuf (vide).",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const original = ctx.message.channel;

        try {
            const clone = await original.clone();
            await original.delete(`Salon renouvelé par ${ctx.author.tag} via +renew`);
            await clone.send({
                embeds: [
                    ctx.embed({
                        title: "♻️ Salon renouvelé",
                        description: "Ce salon a été recréé à neuf (mêmes paramètres, historique vidé).",
                    }),
                ],
            });
        } catch (error) {
            throw new BotError(`Impossible de renouveler ce salon : ${error.message}`);
        }
    },
};
