"use strict";

const { BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "hide",
    category: "owner",
    description: "Masque le salon textuel actuel.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        try {
            await ctx.message.channel.permissionOverwrites.edit(ctx.guild.roles.everyone, { ViewChannel: false });
        } catch {
            throw new BotError("Impossible de masquer ce salon (permissions insuffisantes).");
        }

        await ctx.reply({
            embeds: [ctx.embed({ title: "🙈 Salon masqué", description: `${ctx.message.channel} est maintenant masqué pour @everyone.` })],
        });
    },
};
