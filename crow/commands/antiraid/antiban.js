"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

module.exports = {
    name: "antiban",
    category: "antiraid",
    description: "Active ou désactive la protection anti-bannissement.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const enabled = guardConfigRepo.toggle(ctx.guildId, ctx.identity.key, "antiban");
        await ctx.reply(enabled ? "✅ Anti-ban activé." : "❌ Anti-ban désactivé.");
    },
};
