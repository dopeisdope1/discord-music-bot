"use strict";

const { BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "serverbanner",
    category: "owner",
    description: "Change la bannière du serveur Discord.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const url = ctx.args[0] || null;

        try {
            await ctx.guild.setBanner(url);
        } catch {
            throw new BotError(
                "Impossible de changer la bannière (le serveur n'a peut-être pas le niveau de boost requis, ou l'URL est invalide)."
            );
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🖼️ Bannière du serveur",
                    description: url ? "La bannière du serveur a été mise à jour." : "La bannière du serveur a été retirée.",
                }),
            ],
        });
    },
};
