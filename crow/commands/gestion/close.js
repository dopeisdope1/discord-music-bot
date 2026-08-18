"use strict";

const ticketRepo = require("../../db/repositories/ticketRepo");
const ticketService = require("../../services/ticketService");
const { BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "close",
    category: "gestion",
    description: "Ferme le salon ou le ticket actif.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const ticket = ticketRepo.getByChannel(ctx.message.channel.id);
        if (ticket) {
            await ctx.reply("🔒 Fermeture du ticket en cours...").catch(() => {});
            await ticketService.closeTicket(ctx.message.channel, ctx.author);
            return;
        }

        try {
            await ctx.message.channel.permissionOverwrites.edit(ctx.guild.roles.everyone, {
                SendMessages: false,
            });
        } catch (error) {
            throw new BotError(`Impossible de fermer ce salon : ${error.message}`);
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔒 Salon fermé",
                    description: "Ce salon a été verrouillé (écriture désactivée pour @everyone).",
                }),
            ],
        });
    },
};
