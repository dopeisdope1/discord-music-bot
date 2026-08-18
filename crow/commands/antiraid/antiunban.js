"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

module.exports = {
    name: "antiunban",
    category: "antiraid",
    description: "Active ou désactive la protection anti-débannissement non autorisé.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const enabled = guardConfigRepo.toggle(ctx.guildId, ctx.identity.key, "antiunban");
        await ctx.reply(enabled ? "✅ Anti-unban activé." : "❌ Anti-unban désactivé.");
    },
};
