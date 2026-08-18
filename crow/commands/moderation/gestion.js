"use strict";

const permissionRepo = require("../../db/repositories/permissionRepo");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractRoleId } = require("../../utils/args");

// CrowGESTION-exclusive role-authorization command (crowall excludes it via
// disabledCommands and uses perm/setperm/delperm instead). Also known as
// "+staff" in CrowGESTION's own product spec, hence the alias.
module.exports = {
    name: "gestion",
    category: "moderation",
    description: "Gère les rôles de gestion autorisés.",
    permLevel: LEVEL.ADMIN,
    aliases: ["staff"],
    async execute(ctx) {
        const sub = (ctx.args[0] || "").toLowerCase();
        if (sub !== "add" && sub !== "remove") {
            throw new UsageError("gestion <add|remove> @role");
        }

        const roleId = extractRoleId(ctx.args[1]);
        if (!roleId) throw new UsageError("gestion <add|remove> @role");

        const role = ctx.guild.roles.cache.get(roleId);
        if (!role) throw new BotError("Rôle introuvable sur ce serveur.");

        if (sub === "add") {
            permissionRepo.setRoleLevel(ctx.guildId, roleId, LEVEL.STAFF);
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "✅ Rôle de gestion ajouté",
                        description: `${role} peut désormais utiliser les commandes de gestion (niveau Staff).`,
                    }),
                ],
            });
            return;
        }

        permissionRepo.removeRoleLevel(ctx.guildId, roleId);
        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "✅ Rôle de gestion retiré",
                    description: `${role} n'a plus accès aux commandes de gestion.`,
                }),
            ],
        });
    },
};
