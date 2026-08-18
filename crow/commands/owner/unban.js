"use strict";

const moderationService = require("../../services/moderationService");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");

// Reused as-is by CrowGESTION (see identities/crowgestion.identity.js
// enabledCommands: ["owner:unban"]) — keep this generic, no owner-only assumptions.
module.exports = {
    name: "unban",
    category: "owner",
    description: "Débannit un membre.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const userId = extractUserId(ctx.args[0]);
        if (!userId) throw new UsageError("unban <ID ou @user> [raison]");

        const reason = ctx.args.slice(1).join(" ") || null;

        try {
            await moderationService.unban({ guild: ctx.guild, userId, reason });
        } catch {
            throw new BotError("Impossible de débannir cet utilisateur (il n'est peut-être pas banni sur ce serveur).");
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔓 Débannissement",
                    description: `<@${userId}> (${userId}) a été débanni.`,
                    fields: [{ name: "Raison", value: reason || "Aucune raison fournie" }],
                }),
            ],
        });
    },
};
