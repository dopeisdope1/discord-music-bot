"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const { UsageError } = require("../../core/errors");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");
const { extractRoleId } = require("../../utils/args");

// Reuses the existing antirole guard, scoped via its watched-roles list — does
// NOT create a separate guard. Also used as-is by CrowSECUR (crowguard identity)
// via enabledCommands: ["antiraid:secur"].
module.exports = {
    name: "secur",
    category: "antiraid",
    description: "Gère la sécurité des rôles sensibles.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const sub = (ctx.args[0] || "list").toLowerCase();

        if (sub === "add" || sub === "remove") {
            const roleId = extractRoleId(ctx.args[1]);
            if (!roleId) throw new UsageError(`secur ${sub} @role`);

            if (sub === "add") {
                guardConfigRepo.addWatchedRole(ctx.guildId, ctx.identity.key, "antirole", roleId);
                const config = guardConfigRepo.getConfig(ctx.guildId, ctx.identity.key, "antirole");
                if (!config?.enabled) {
                    guardConfigRepo.setEnabled(ctx.guildId, ctx.identity.key, "antirole", true);
                }
                await ctx.reply(`✅ <@&${roleId}> ajouté aux rôles sensibles surveillés.`);
            } else {
                guardConfigRepo.removeWatchedRole(ctx.guildId, ctx.identity.key, "antirole", roleId);
                await ctx.reply(`✅ <@&${roleId}> retiré des rôles sensibles surveillés.`);
            }
            return;
        }

        if (sub === "clear") {
            guardConfigRepo.clearWatchedRoles(ctx.guildId, ctx.identity.key, "antirole");
            await ctx.reply("✅ Liste des rôles sensibles surveillés vidée.");
            return;
        }

        if (sub === "list") {
            const roleIds = guardConfigRepo.listWatchedRoles(ctx.guildId, ctx.identity.key, "antirole");
            if (roleIds.length === 0) {
                await ctx.reply("Aucun rôle sensible surveillé.");
                return;
            }
            const embed = ctx.embed({
                title: "🛡️ Rôles sensibles surveillés",
                description: roleIds.map((id) => `<@&${id}>`).join("\n"),
            });
            await ctx.reply({ embeds: [embed] });
            return;
        }

        throw new UsageError("secur [add|remove|list|clear] @role");
    },
};
