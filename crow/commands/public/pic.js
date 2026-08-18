"use strict";

const { extractUserId } = require("../../utils/args");
const { BotError } = require("../../core/errors");

module.exports = {
    name: "pic",
    category: "public",
    description: "Affiche la photo de profil d'un utilisateur.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]) || ctx.author.id;
        const user = await ctx.client.users.fetch(targetId).catch(() => null);
        if (!user) throw new BotError("Utilisateur introuvable.");

        const avatarURL = user.displayAvatarURL({ size: 1024, extension: "png" });

        await ctx.reply({
            embeds: [ctx.embed({ title: `🖼️ Photo de profil de ${user.tag}` }).setImage(avatarURL)],
        });
    },
};
