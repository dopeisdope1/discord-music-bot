"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

module.exports = {
    name: "antideco",
    category: "antiraid",
    description: "Active ou désactive la protection anti-déconnexion.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const enabled = guardConfigRepo.toggle(ctx.guildId, ctx.identity.key, "antideco");
        await ctx.reply(enabled ? "✅ Anti-déconnexion activé." : "❌ Anti-déconnexion désactivé.");
    },
};
