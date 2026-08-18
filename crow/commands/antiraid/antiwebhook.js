"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

module.exports = {
    name: "antiwebhook",
    category: "antiraid",
    description: "Active ou désactive la protection anti-webhooks.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const enabled = guardConfigRepo.toggle(ctx.guildId, ctx.identity.key, "antiwebhook");
        await ctx.reply(enabled ? "✅ Anti-webhooks activé." : "❌ Anti-webhooks désactivé.");
    },
};
