"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

module.exports = {
    name: "antijoin",
    category: "antiraid",
    description: "Active ou désactive le filtre d'arrivée massive.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const enabled = guardConfigRepo.toggle(ctx.guildId, ctx.identity.key, "antijoin");
        await ctx.reply(enabled ? "✅ Filtre d'arrivée massive activé." : "❌ Filtre d'arrivée massive désactivé.");
    },
};
