"use strict";

const permissionRepo = require("../../db/repositories/permissionRepo");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractRoleId } = require("../../utils/args");

module.exports = {
    name: "delperm",
    category: "owner",
    description: "Retire un niveau de permission à un rôle.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const level = Number(ctx.args[0]);
        const roleId = extractRoleId(ctx.args[1]);
        if (![1, 2, 3].includes(level) || !roleId) throw new UsageError("delperm <1|2|3> @role");

        const role = ctx.guild.roles.cache.get(roleId);
        if (!role) throw new BotError("Rôle introuvable sur ce serveur.");

        permissionRepo.removeRoleLevel(ctx.guildId, roleId);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "✅ Permission retirée",
                    description: `Le niveau de permission de ${role} a été retiré.`,
                }),
            ],
        });
    },
};
