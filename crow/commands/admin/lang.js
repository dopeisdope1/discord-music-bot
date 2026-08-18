"use strict";

const guildSettingsRepo = require("../../db/repositories/guildSettingsRepo");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "lang",
    category: "admin",
    description: "Modifie la langue du bot.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const value = (ctx.args[0] || "").toLowerCase();
        if (value !== "fr" && value !== "en") throw new UsageError("lang <fr|en>");

        guildSettingsRepo.setField(ctx.guildId, ctx.identity.key, "lang", value);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🌐 Langue mise à jour",
                    description: `La préférence de langue est désormais **${value}**. Aucun catalogue de traductions n'est encore branché : ce réglage est simplement enregistré pour un usage futur.`,
                }),
            ],
        });
    },
};
