"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

module.exports = {
    name: "antikick",
    category: "antiraid",
    description: "Active ou désactive la protection anti-kick.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const enabled = guardConfigRepo.toggle(ctx.guildId, ctx.identity.key, "antikick");
        await ctx.reply(enabled ? "✅ Anti-kick activé." : "❌ Anti-kick désactivé.");
    },
};
