"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");

module.exports = {
    name: "change",
    category: "owner",
    description: "Renomme un membre.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("change @user [nom]");

        const member = await ctx.guild.members.fetch(targetId).catch(() => null);
        if (!member) throw new BotError("Membre introuvable sur ce serveur.");

        // No name given -> reset the nickname instead of requiring one.
        const name = ctx.args.slice(1).join(" ") || null;

        try {
            await member.setNickname(name);
        } catch {
            throw new BotError("Impossible de renommer ce membre (hiérarchie de rôles ou permissions).");
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "✏️ Membre renommé",
                    description: name ? `${member} a été renommé en **${name}**.` : `Le pseudo de ${member} a été réinitialisé.`,
                }),
            ],
        });
    },
};
