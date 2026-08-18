"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const { UsageError } = require("../../core/errors");
const { extractRoleId } = require("../../utils/args");
const blacklistRepo = require("../../db/repositories/blacklistRepo");

module.exports = {
    name: "setrole",
    category: "blr",
    description: "Définit ou retire un rôle spécial de la BLR.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const roleId = extractRoleId(ctx.args[0]);
        if (!roleId) throw new UsageError("setrole @role");

        const current = blacklistRepo.specialRoleList(ctx.guildId, ctx.identity.key);
        if (current.includes(roleId)) {
            blacklistRepo.specialRoleRemove(ctx.guildId, ctx.identity.key, roleId);
            await ctx.reply(`❌ <@&${roleId}> retiré des rôles spéciaux de la BLR.`);
        } else {
            blacklistRepo.specialRoleAdd(ctx.guildId, ctx.identity.key, roleId);
            await ctx.reply(`✅ <@&${roleId}> ajouté aux rôles spéciaux de la BLR.`);
        }
    },
};
