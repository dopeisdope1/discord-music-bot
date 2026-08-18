"use strict";

const moderationService = require("../../services/moderationService");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");

module.exports = {
    name: "kick",
    category: "moderation",
    description: "Exclut un membre du serveur.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("kick @user [raison]");

        const target = await ctx.guild.members.fetch(targetId).catch(() => null);
        if (!target) throw new BotError("Membre introuvable sur ce serveur.");

        const reason = ctx.args.slice(1).join(" ") || null;

        const id = await moderationService.kick({
            guild: ctx.guild,
            target,
            moderator: ctx.author,
            identityKey: ctx.identity.key,
            reason,
        });

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "👢 Expulsion",
                    description: `${target.user.tag} (${target.id}) a été expulsé.`,
                    fields: [
                        { name: "Sanction", value: `#${id}`, inline: true },
                        { name: "Raison", value: reason || "Aucune raison fournie", inline: true },
                    ],
                }),
            ],
        });
    },
};
