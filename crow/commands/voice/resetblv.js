"use strict";

const voiceRepo = require("../../db/repositories/voiceRepo");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "resetblv",
    category: "voice",
    description: "Réinitialise toutes les blacklists vocales.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const count = voiceRepo.resetAllBans(ctx.guildId);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🧹 Blacklists vocales réinitialisées",
                    description: `${count} bannissement(s) supprimé(s).`,
                }),
            ],
        });
    },
};
