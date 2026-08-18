"use strict";

const messageRouter = require("../../core/messageRouter");
const sanctionsRepo = require("../../db/repositories/sanctionsRepo");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "sync",
    category: "owner",
    description: "Synchronise la base de données locale du bot.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        messageRouter.invalidateRegistryCache();

        const sanctionCount = sanctionsRepo.countByGuild(ctx.guildId);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔄 Synchronisation",
                    description: "Le cache des commandes a été invalidé — les commandes seront rechargées au prochain message.",
                    fields: [{ name: "Sanctions enregistrées sur ce serveur", value: `${sanctionCount}`, inline: true }],
                }),
            ],
        });
    },
};
