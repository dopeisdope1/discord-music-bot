"use strict";

const { extractUserId } = require("../../utils/args");
const { BotError } = require("../../core/errors");

module.exports = {
    name: "banner",
    category: "public",
    description: "Affiche la bannière d'un utilisateur.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]) || ctx.author.id;

        // force: true bypasses the user cache, which doesn't carry banner data.
        const user = await ctx.client.users.fetch(targetId, { force: true }).catch(() => null);
        if (!user) throw new BotError("Utilisateur introuvable.");

        const bannerURL = user.bannerURL({ size: 1024 });
        if (!bannerURL) throw new BotError("Cet utilisateur n'a pas de bannière.");

        await ctx.reply({
            embeds: [ctx.embed({ title: `🖼️ Bannière de ${user.tag}` }).setImage(bannerURL)],
        });
    },
};
