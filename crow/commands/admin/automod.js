"use strict";

const guildSettingsRepo = require("../../db/repositories/guildSettingsRepo");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "automod",
    category: "admin",
    description: "Active ou désactive l'AutoMod Discord.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const value = (ctx.args[0] || "").toLowerCase();
        if (value !== "on" && value !== "off") throw new UsageError("automod <on|off>");

        guildSettingsRepo.setField(ctx.guildId, ctx.identity.key, "automod_enabled", value === "on" ? 1 : 0);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🛡️ AutoMod",
                    description: `L'AutoMod est désormais **${value === "on" ? "activé" : "désactivé"}**. (Ce réglage est un simple indicateur consulté par d'autres fonctionnalités ; il ne pilote pas encore l'AutoMod natif de Discord.)`,
                }),
            ],
        });
    },
};
