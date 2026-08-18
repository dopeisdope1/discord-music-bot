"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const { UsageError } = require("../../core/errors");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");
const { extractRoleId } = require("../../utils/args");

module.exports = {
    name: "pingraid",
    category: "antiraid",
    description: "Définit le rôle à ping en cas de raid.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const roleId = extractRoleId(ctx.args[0]);
        if (!roleId) throw new UsageError("pingraid @role");

        guardConfigRepo.setRaidPingRole(ctx.guildId, ctx.identity.key, roleId);
        await ctx.reply(`✅ Rôle de ping raid défini sur <@&${roleId}>.`);
    },
};
