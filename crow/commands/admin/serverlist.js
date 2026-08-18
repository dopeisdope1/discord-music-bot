"use strict";

const { PermissionError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { paginate } = require("../../utils/pagination");
const { chunk } = require("../../utils/embeds");

module.exports = {
    name: "serverlist",
    category: "admin",
    description: "Affiche la liste des serveurs du bot.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        if (!ctx.botOwner) throw new PermissionError("Réservé aux propriétaires du bot.");

        const lines = [...ctx.client.guilds.cache.values()].map((g) => `${g.name} (${g.memberCount})`);
        const groups = chunk(lines, 20);
        if (groups.length === 0) groups.push([]);

        const pages = groups.map((group, i) =>
            ctx.embed({
                title: `🌍 Serveurs (${lines.length})`,
                description: group.join("\n") || "Aucun serveur.",
                footer: `Page ${i + 1}/${groups.length}`,
            })
        );

        await paginate(ctx.message, pages);
    },
};
