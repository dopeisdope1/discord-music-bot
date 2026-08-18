"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "delete",
    category: "gestion",
    description: "Supprime le salon actuel.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        await ctx.send({
            embeds: [
                ctx.embed({
                    title: "⚠️ Suppression imminente",
                    description: "Ce salon va être supprimé dans 3 secondes...",
                }),
            ],
        });

        await new Promise((r) => setTimeout(r, 3000));

        await ctx.message.channel.delete().catch(() => {});
    },
};
