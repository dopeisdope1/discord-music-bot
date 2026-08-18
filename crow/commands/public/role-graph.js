"use strict";

const { paginate } = require("../../utils/pagination");
const { BotError } = require("../../core/errors");

const BAR_LENGTH = 20;
const TOP_N = 15;
const PAGE_SIZE = 15;

module.exports = {
    name: "role-graph",
    category: "public",
    description: "Affiche un graphique de répartition des rôles.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        // Role#members depends on the member cache being populated.
        await ctx.guild.members.fetch();

        const roles = [...ctx.guild.roles.cache.values()]
            .filter((r) => r.id !== ctx.guild.id) // skip @everyone
            .map((r) => ({ name: r.name, count: r.members.size }))
            .sort((a, b) => b.count - a.count)
            .slice(0, TOP_N);

        if (!roles.length) throw new BotError("Ce serveur n'a aucun rôle.");

        const max = Math.max(...roles.map((r) => r.count), 1);

        const lines = roles.map((r) => {
            const filled = Math.round((r.count / max) * BAR_LENGTH);
            const bar = "█".repeat(filled) + "░".repeat(BAR_LENGTH - filled);
            const name = r.name.length > 18 ? `${r.name.slice(0, 17)}…` : r.name.padEnd(18, " ");
            return `\`${name}\` ${bar} ${r.count}`;
        });

        const chunks = [];
        for (let i = 0; i < lines.length; i += PAGE_SIZE) {
            chunks.push(lines.slice(i, i + PAGE_SIZE));
        }

        const pages = chunks.map((chunk, pageIndex) =>
            ctx.embed({
                title: `📊 Répartition des rôles (top ${roles.length}) — page ${pageIndex + 1}/${chunks.length}`,
                description: chunk.join("\n"),
            })
        );

        await paginate(ctx.message, pages);
    },
};
