"use strict";

const blacklistRepo = require("../../db/repositories/blacklistRepo");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");

module.exports = {
    name: "gblinfo",
    category: "bl",
    description: "Affiche les détails d'une blacklist.",
    permLevel: LEVEL.STAFF,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("gblinfo @user");

        const entry = blacklistRepo.globalGet(targetId);
        if (!entry) {
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "⛔ Blacklist globale",
                        description: "Cet utilisateur n'est pas dans la blacklist globale.",
                    }),
                ],
            });
            return;
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "⛔ Blacklist globale",
                    description: `<@${entry.user_id}>`,
                    fields: [
                        { name: "Raison", value: entry.reason || "Aucune raison fournie", inline: true },
                        { name: "Ajouté par", value: `<@${entry.added_by}>`, inline: true },
                        { name: "Portée", value: entry.scope || "network", inline: true },
                        { name: "Date", value: `<t:${Math.floor(entry.added_at / 1000)}:F>`, inline: true },
                    ],
                }),
            ],
        });
    },
};
