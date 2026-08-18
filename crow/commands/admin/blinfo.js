"use strict";

const blacklistRepo = require("../../db/repositories/blacklistRepo");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");

module.exports = {
    name: "blinfo",
    category: "admin",
    description: "Affiche les détails de blacklist d'un membre.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("blinfo @user");

        const entry = blacklistRepo.guildGet(ctx.guildId, targetId);
        if (!entry) {
            await ctx.reply({
                embeds: [ctx.embed({ title: "⛔ Blacklist", description: "Pas dans la liste noire." })],
            });
            return;
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "⛔ Blacklist",
                    description: `<@${entry.user_id}>`,
                    fields: [
                        { name: "Raison", value: entry.reason || "Aucune raison fournie", inline: true },
                        { name: "Ajouté par", value: `<@${entry.added_by}>`, inline: true },
                        { name: "Date", value: `<t:${Math.floor(entry.added_at / 1000)}:F>`, inline: true },
                    ],
                }),
            ],
        });
    },
};
