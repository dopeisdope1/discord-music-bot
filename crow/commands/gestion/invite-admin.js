"use strict";

const { BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "invite-admin",
    category: "gestion",
    description: "Génère une invitation d'administration rapide.",
    permLevel: LEVEL.ADMIN, // elevated: creates a permanent (maxAge/maxUses = 0) invite
    aliases: [],
    async execute(ctx) {
        let invite;
        try {
            invite = await ctx.message.channel.createInvite({ maxAge: 0, maxUses: 0 });
        } catch (error) {
            throw new BotError(`Impossible de créer l'invitation : ${error.message}`);
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔗 Invitation d'administration",
                    description: `Invitation permanente : https://discord.gg/${invite.code}`,
                }),
            ],
        });
    },
};
