"use strict";

const moderationService = require("../../services/moderationService");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "unmuteall",
    category: "moderation",
    description: "Démute l'intégralité des membres du serveur.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const count = await moderationService.unmuteAll({
            guild: ctx.guild,
            moderator: ctx.author,
            identityKey: ctx.identity.key,
        });

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔊 Démute global",
                    description: `${count} membre(s) démuté(s).`,
                }),
            ],
        });
    },
};
