"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

module.exports = {
    name: "antirole",
    category: "antiraid",
    description: "Active ou désactive la protection anti-rôles.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const enabled = guardConfigRepo.toggle(ctx.guildId, ctx.identity.key, "antirole");
        await ctx.reply(enabled ? "✅ Anti-rôles activé." : "❌ Anti-rôles désactivé.");
    },
};
