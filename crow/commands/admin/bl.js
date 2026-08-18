"use strict";

const blacklistRepo = require("../../db/repositories/blacklistRepo");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");

module.exports = {
    name: "bl",
    category: "admin",
    description: "Ajoute un utilisateur à la blacklist.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("bl @user [raison]");

        const reason = ctx.args.slice(1).join(" ") || null;
        blacklistRepo.guildAdd(ctx.guildId, targetId, reason, ctx.author.id);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "⛔ Blacklist",
                    description: `<@${targetId}> a été ajouté à la liste noire (liste informative, aucun bannissement automatique).`,
                    fields: [{ name: "Raison", value: reason || "Aucune raison fournie" }],
                }),
            ],
        });
    },
};
