"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

module.exports = {
    name: "antieveryone",
    category: "antiraid",
    description: "Bloque la mention everyone/here.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const enabled = guardConfigRepo.toggle(ctx.guildId, ctx.identity.key, "antieveryone");
        await ctx.reply(enabled ? "✅ Anti-everyone activé." : "❌ Anti-everyone désactivé.");
    },
};
