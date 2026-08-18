"use strict";

const moderationService = require("../../services/moderationService");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");

module.exports = {
    name: "derank",
    category: "moderation",
    description: "Retire tous les rôles administratifs d'un membre.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("derank @user [raison]");

        const target = await ctx.guild.members.fetch(targetId).catch(() => null);
        if (!target) throw new BotError("Membre introuvable sur ce serveur.");

        const reason = ctx.args.slice(1).join(" ") || null;

        const id = await moderationService.derank({
            guild: ctx.guild,
            target,
            moderator: ctx.author,
            identityKey: ctx.identity.key,
            reason,
        });

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🚫 Derank",
                    description: `${target} a été dérank (rôles administratifs retirés).`,
                    fields: [{ name: "Sanction", value: `#${id}`, inline: true }],
                }),
            ],
        });
    },
};
