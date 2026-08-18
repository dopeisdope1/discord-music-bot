"use strict";

const permissionRepo = require("../../db/repositories/permissionRepo");
const { LEVEL, LEVEL_NAMES } = require("../../core/permissions/permissionLevels");
const { paginate } = require("../../utils/pagination");
const { chunk, listField } = require("../../utils/embeds");

const PAGE_SIZE = 15;

module.exports = {
    name: "perm-check",
    category: "owner",
    description: "Affiche les permissions configurées.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const roles = permissionRepo.listRoles(ctx.guildId).map((r) => ({
            line: `<@&${r.role_id}> → **${LEVEL_NAMES[r.level]}** (${r.level})`,
            level: r.level,
        }));
        const users = permissionRepo.listUsers(ctx.guildId).map((u) => ({
            line: `<@${u.user_id}> → **${LEVEL_NAMES[u.level]}** (${u.level})`,
            level: u.level,
        }));

        const all = [...roles, ...users].sort((a, b) => b.level - a.level).map((x) => x.line);

        if (!all.length) {
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "🔐 Permissions configurées",
                        description: "Aucun rôle ni utilisateur configuré.",
                    }),
                ],
            });
            return;
        }

        const chunks = chunk(all, PAGE_SIZE);
        const pages = chunks.map((c, i) =>
            ctx.embed({
                title: `🔐 Permissions configurées (page ${i + 1}/${chunks.length})`,
                description: listField(c, { limit: PAGE_SIZE }),
            })
        );

        await paginate(ctx.message, pages);
    },
};
