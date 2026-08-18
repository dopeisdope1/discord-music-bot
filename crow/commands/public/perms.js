"use strict";

const permissionRepo = require("../../db/repositories/permissionRepo");
const { LEVEL, LEVEL_NAMES } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "perms",
    category: "public",
    description: "Affiche les rôles/membres associés à chaque niveau de permission.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const roles = permissionRepo.listRoles(ctx.guildId);
        const users = permissionRepo.listUsers(ctx.guildId);

        const fields = [];
        for (const level of [LEVEL.STAFF, LEVEL.MOD, LEVEL.ADMIN]) {
            const roleMentions = roles.filter((r) => r.level === level).map((r) => `<@&${r.role_id}>`);
            const userMentions = users.filter((u) => u.level === level).map((u) => `<@${u.user_id}>`);
            const mentions = [...roleMentions, ...userMentions];

            fields.push({
                name: `Permission ${level} (${LEVEL_NAMES[level]})`,
                value: mentions.length ? mentions.join(", ") : "*Aucun rôle ni membre*",
            });
        }

        fields.push({
            name: "Toujours Admin (natif)",
            value: "Le propriétaire du serveur et tout membre avec la permission Discord **Administrateur** ont automatiquement le niveau 3, sans configuration.",
        });

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: `🔐 Permissions — ${ctx.identity.displayName}`,
                    description: "Niveaux de permission configurés sur ce serveur (partagés entre les 5 bots Crow).",
                    fields,
                    footer: `Configurer : setperm/delperm <1-3> @role, ou owner/sys add @user`,
                }),
            ],
        });
    },
};
