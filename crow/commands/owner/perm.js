"use strict";

const permissionRepo = require("../../db/repositories/permissionRepo");
const { LEVEL, LEVEL_NAMES } = require("../../core/permissions/permissionLevels");
const { listField } = require("../../utils/embeds");

// Informational/list view of the role->level mapping. Setting/removing levels
// is owned by setperm/delperm; see perm-check for the more detailed view that
// also includes per-user overrides.
module.exports = {
    name: "perm",
    category: "owner",
    description: "Configure les permissions globales des commandes.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const roles = permissionRepo.listRoles(ctx.guildId);

        const lines = roles
            .sort((a, b) => b.level - a.level)
            .map((r) => `<@&${r.role_id}> → **${LEVEL_NAMES[r.level]}** (${r.level})`);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔐 Permissions par rôle",
                    description: listField(lines, { empty: "Aucun rôle configuré. Utilise `setperm <1|2|3> @role`." }),
                    footer: "setperm / delperm pour modifier",
                }),
            ],
        });
    },
};
