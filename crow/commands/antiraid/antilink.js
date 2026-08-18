"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

module.exports = {
    name: "antilink",
    category: "antiraid",
    description: "Active ou désactive la protection anti-liens.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const enabled = guardConfigRepo.toggle(ctx.guildId, ctx.identity.key, "antilink");
        await ctx.reply(enabled ? "✅ Anti-liens activé." : "❌ Anti-liens désactivé.");
    },
};
