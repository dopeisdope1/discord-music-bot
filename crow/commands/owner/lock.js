"use strict";

const { BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "lock",
    category: "owner",
    description: "Verrouille l'accès en écriture au salon actuel.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        try {
            await ctx.message.channel.permissionOverwrites.edit(ctx.guild.roles.everyone, { SendMessages: false });
        } catch {
            throw new BotError("Impossible de verrouiller ce salon (permissions insuffisantes).");
        }

        await ctx.reply({
            embeds: [ctx.embed({ title: "🔒 Salon verrouillé", description: `${ctx.message.channel} est maintenant en lecture seule pour @everyone.` })],
        });
    },
};
