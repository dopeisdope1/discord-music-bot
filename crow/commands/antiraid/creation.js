"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const { UsageError } = require("../../core/errors");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");
const { parseDuration, formatDuration } = require("../../utils/time");

module.exports = {
    name: "creation",
    category: "antiraid",
    description: "Configure les vérifications d'âge minimum de compte.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const arg = ctx.args[0];

        if (!arg) {
            const minAgeMs = guardConfigRepo.getAccountAgeRequirement(ctx.guildId);
            if (!minAgeMs) {
                await ctx.reply("Aucune exigence d'âge de compte configurée.");
            } else {
                await ctx.reply(`🔎 Âge de compte minimum requis : **${formatDuration(minAgeMs)}**.`);
            }
            return;
        }

        if (arg.toLowerCase() === "off") {
            guardConfigRepo.clearAccountAgeRequirement(ctx.guildId);
            await ctx.reply("❌ Exigence d'âge de compte désactivée.");
            return;
        }

        const ms = parseDuration(arg);
        if (!ms) throw new UsageError("creation <durée ex: 7d> | creation off");

        guardConfigRepo.setAccountAgeRequirement(ctx.guildId, ms);
        await ctx.reply(`✅ Âge de compte minimum requis défini sur **${formatDuration(ms)}**.`);
    },
};
