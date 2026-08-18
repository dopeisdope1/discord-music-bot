"use strict";

const afkRepo = require("../../db/repositories/afkRepo");

module.exports = {
    name: "afk",
    category: "public",
    description: "Définit votre statut AFK.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const reason = ctx.args.join(" ") || null;
        afkRepo.set(ctx.guildId, ctx.author.id, reason);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "💤 Statut AFK activé",
                    description: reason ? `Tu es maintenant AFK : ${reason}` : "Tu es maintenant AFK.",
                }),
            ],
        });
    },
};
