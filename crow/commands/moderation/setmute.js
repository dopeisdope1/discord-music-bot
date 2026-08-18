"use strict";

const sanctionsRepo = require("../../db/repositories/sanctionsRepo");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractRoleId } = require("../../utils/args");

module.exports = {
    name: "setmute",
    category: "moderation",
    description: "Configure le rôle de mute par défaut.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const roleId = extractRoleId(ctx.args[0]);
        if (!roleId) throw new UsageError("setmute @role");

        const role = ctx.guild.roles.cache.get(roleId);
        if (!role) throw new BotError("Rôle introuvable sur ce serveur.");

        sanctionsRepo.setMuteRole(ctx.guildId, roleId);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "⚙️ Rôle de mute configuré",
                    description: `Le rôle de mute est désormais ${role}.`,
                }),
            ],
        });
    },
};
