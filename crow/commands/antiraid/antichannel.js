"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

module.exports = {
    name: "antichannel",
    category: "antiraid",
    description: "Active ou désactive la protection anti-salons.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const enabled = guardConfigRepo.toggle(ctx.guildId, ctx.identity.key, "antichannel");
        await ctx.reply(enabled ? "✅ Anti-salons activé." : "❌ Anti-salons désactivé.");
    },
};
