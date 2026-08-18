"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "setbanner",
    category: "admin",
    description: "Modifie la bannière du bot.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const url = ctx.args[0];
        if (!url) throw new UsageError("setbanner [URL]");

        try {
            await ctx.client.user.setBanner(url);
        } catch {
            throw new BotError("Impossible de changer la bannière (URL invalide, niveau de boost insuffisant ou limite de Discord atteinte).");
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🖼️ Bannière mise à jour",
                    description:
                        "La bannière du bot a été changée. Ce changement affecte le compte du bot sur TOUS les serveurs, pas seulement celui-ci.",
                }),
            ],
        });
    },
};
