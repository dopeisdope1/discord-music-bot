"use strict";

const permissionRepo = require("../../db/repositories/permissionRepo");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL, LEVEL_NAMES } = require("../../core/permissions/permissionLevels");
const { extractRoleId } = require("../../utils/args");

module.exports = {
    name: "setperm",
    category: "owner",
    description: "Définit un niveau de permission sur un rôle.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const level = Number(ctx.args[0]);
        const roleId = extractRoleId(ctx.args[1]);
        if (![1, 2, 3].includes(level) || !roleId) throw new UsageError("setperm <1|2|3> @role");

        const role = ctx.guild.roles.cache.get(roleId);
        if (!role) throw new BotError("Rôle introuvable sur ce serveur.");

        permissionRepo.setRoleLevel(ctx.guildId, roleId, level);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "✅ Permission définie",
                    description: `${role} est maintenant au niveau **${LEVEL_NAMES[level]}** (${level}).`,
                }),
            ],
        });
    },
};
