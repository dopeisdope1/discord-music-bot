"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

module.exports = {
    name: "antiupdate",
    category: "antiraid",
    description: "Active ou désactive la protection anti-modification.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const enabled = guardConfigRepo.toggle(ctx.guildId, ctx.identity.key, "antiupdate");
        await ctx.reply(enabled ? "✅ Anti-modification activé." : "❌ Anti-modification désactivé.");
    },
};
