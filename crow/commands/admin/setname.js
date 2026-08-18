"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "setname",
    category: "admin",
    description: "Modifie le nom d'utilisateur du bot.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const name = ctx.args.join(" ").trim();
        if (!name) throw new UsageError("setname [nom]");

        try {
            await ctx.client.user.setUsername(name);
        } catch {
            throw new BotError("Impossible de changer le nom (nom invalide ou limite de Discord atteinte).");
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "✏️ Nom mis à jour",
                    description: `Le nom du bot est désormais **${name}**. Ce changement affecte le compte du bot sur TOUS les serveurs, pas seulement celui-ci.`,
                }),
            ],
        });
    },
};
