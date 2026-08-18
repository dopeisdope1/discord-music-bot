"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractRoleId } = require("../../utils/args");
const { paginate } = require("../../utils/pagination");
const { chunk } = require("../../utils/embeds");

module.exports = {
    name: "rolemembers",
    category: "gestion",
    description: "Affiche tous les membres possédant le rôle.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const roleId = extractRoleId(ctx.args[0]);
        if (!roleId) throw new UsageError("rolemembers @role");

        const role = ctx.guild.roles.cache.get(roleId);
        if (!role) throw new BotError("Rôle introuvable sur ce serveur.");

        await ctx.guild.members.fetch();
        const members = role.members.map((m) => `${m} (${m.user.tag})`);

        if (!members.length) {
            await ctx.reply({
                embeds: [
                    ctx.embed({ title: `👥 Membres avec ${role.name}`, description: "Aucun membre." }),
                ],
            });
            return;
        }

        const groups = chunk(members, 20);
        const pages = groups.map((group, i) =>
            ctx.embed({
                title: `👥 Membres avec ${role.name} (${members.length})`,
                description: group.join("\n"),
                footer: `Page ${i + 1}/${groups.length}`,
            })
        );

        await paginate(ctx.message, pages);
    },
};
