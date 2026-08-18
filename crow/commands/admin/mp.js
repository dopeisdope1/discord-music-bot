"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");

module.exports = {
    name: "mp",
    category: "admin",
    description: "Envoie un message privé à un utilisateur.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        const text = ctx.args.slice(1).join(" ").trim();
        if (!targetId || !text) throw new UsageError("mp @user [message]");

        const user = await ctx.client.users.fetch(targetId).catch(() => null);
        if (!user) throw new BotError("Utilisateur introuvable.");

        try {
            await user.send(text);
        } catch {
            throw new BotError("Impossible d'envoyer un message privé à cet utilisateur (messages privés fermés).");
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "✉️ Message envoyé",
                    description: `Message privé envoyé à ${user.tag}.`,
                }),
            ],
        });
    },
};
