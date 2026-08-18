"use strict";

const { BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "unlock",
    category: "owner",
    description: "Déverrouille l'accès en écriture au salon actuel.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        try {
            await ctx.message.channel.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: null });
        } catch {
            throw new BotError("Impossible de déverrouiller ce salon (permissions insuffisantes).");
        }

        await ctx.reply({
            embeds: [ctx.embed({ title: "🔓 Salon déverrouillé", description: `${ctx.message.channel} n'est plus en lecture seule.` })],
        });
    },
};
