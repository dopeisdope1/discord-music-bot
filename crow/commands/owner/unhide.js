"use strict";

const { BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "unhide",
    category: "owner",
    description: "Démasque le salon textuel actuel.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        try {
            // Reset to inherited/default rather than explicitly allowing — the
            // correct "undo" for a prior hide, doesn't grant access the role
            // structure wouldn't otherwise provide.
            await ctx.message.channel.permissionOverwrites.edit(ctx.guild.roles.everyone, { ViewChannel: null });
        } catch {
            throw new BotError("Impossible de démasquer ce salon (permissions insuffisantes).");
        }

        await ctx.reply({
            embeds: [ctx.embed({ title: "👁️ Salon démasqué", description: `${ctx.message.channel} n'est plus masqué pour @everyone.` })],
        });
    },
};
