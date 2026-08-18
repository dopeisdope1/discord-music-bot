"use strict";

module.exports = {
    name: "support",
    category: "public",
    description: "Fournit le lien vers le serveur de support.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        // No support server URL exists anywhere in this project's config yet —
        // never fabricate one, just say so plainly.
        await ctx.reply("ℹ️ Aucun lien de support configuré pour le moment.");
    },
};
