"use strict";

const permissionRepo = require("../../db/repositories/permissionRepo");
const { LEVEL, LEVEL_NAMES } = require("../../core/permissions/permissionLevels");
const { listField } = require("../../utils/embeds");

module.exports = {
    name: "staff-list",
    category: "owner",
    description: "Affiche les membres du staff configurés.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const roles = permissionRepo.listRoles(ctx.guildId);
        const users = permissionRepo.listUsers(ctx.guildId);

        const fields = [3, 2, 1].map((level) => {
            const roleLines = roles.filter((r) => r.level === level).map((r) => `<@&${r.role_id}>`);
            const userLines = users.filter((u) => u.level === level).map((u) => `<@${u.user_id}>`);
            return {
                name: `${LEVEL_NAMES[level]} (${level})`,
                value: listField([...roleLines, ...userLines], { empty: "Aucun." }),
            };
        });

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🛡️ Staff configuré",
                    fields,
                }),
            ],
        });
    },
};
