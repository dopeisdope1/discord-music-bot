"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

module.exports = {
    name: "antibot",
    category: "antiraid",
    description: "Active ou désactive la protection anti-bots.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const enabled = guardConfigRepo.toggle(ctx.guildId, ctx.identity.key, "antibot");
        await ctx.reply(enabled ? "✅ Anti-bots activé." : "❌ Anti-bots désactivé.");
    },
};
