"use strict";

const moderationService = require("../../services/moderationService");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");

module.exports = {
    name: "ban",
    category: "moderation",
    description: "Bannit un membre du serveur.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("ban @user [raison]");

        // Ban works even if the target isn't a current member, so we only need
        // a User, not a GuildMember.
        const user = await ctx.client.users.fetch(targetId).catch(() => null);
        if (!user) throw new BotError("Utilisateur introuvable.");

        const reason = ctx.args.slice(1).join(" ") || null;

        const id = await moderationService.ban({
            guild: ctx.guild,
            target: user,
            moderator: ctx.author,
            identityKey: ctx.identity.key,
            reason,
        });

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔨 Bannissement",
                    description: `${user.tag} (${user.id}) a été banni.`,
                    fields: [
                        { name: "Sanction", value: `#${id}`, inline: true },
                        { name: "Raison", value: reason || "Aucune raison fournie", inline: true },
                    ],
                }),
            ],
        });
    },
};
