"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "setpic",
    category: "admin",
    description: "Change l'avatar du bot.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const url = ctx.args[0];
        if (!url) throw new UsageError("setpic [URL]");

        try {
            await ctx.client.user.setAvatar(url);
        } catch {
            throw new BotError("Impossible de changer l'avatar (URL invalide ou limite de Discord atteinte).");
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🖼️ Avatar mis à jour",
                    description:
                        "L'avatar du bot a été changé. Ce changement affecte le compte du bot sur TOUS les serveurs, pas seulement celui-ci.",
                }),
            ],
        });
    },
};
