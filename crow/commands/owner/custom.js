"use strict";

const customCommandRepo = require("../../db/repositories/customCommandRepo");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { paginate } = require("../../utils/pagination");
const { chunk, listField } = require("../../utils/embeds");

const PAGE_SIZE = 15;

// Management only — actually triggering a custom command at message time is
// wired in events/messageCreate.event.js via customCommandRepo.get() after
// built-in commands don't match.
module.exports = {
    name: "custom",
    category: "owner",
    description: "Gère les commandes personnalisées.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const sub = ctx.args[0]?.toLowerCase();

        if (sub === "add") {
            const name = ctx.args[1];
            const response = ctx.args.slice(2).join(" ");
            if (!name || !response) throw new UsageError("custom add <nom> <réponse...>");

            customCommandRepo.create(ctx.guildId, name, response, ctx.author.id);

            await ctx.reply({
                embeds: [ctx.embed({ title: "✅ Commande personnalisée ajoutée", description: `\`${name.toLowerCase()}\` a été enregistrée.` })],
            });
        } else if (sub === "remove") {
            const name = ctx.args[1];
            if (!name) throw new UsageError("custom remove <nom>");

            const removed = customCommandRepo.remove(ctx.guildId, name);

            await ctx.reply(
                removed ? `✅ Commande personnalisée \`${name.toLowerCase()}\` supprimée.` : `❌ Aucune commande personnalisée nommée \`${name.toLowerCase()}\`.`
            );
        } else if (sub === "list") {
            const rows = customCommandRepo.list(ctx.guildId);

            if (!rows.length) {
                await ctx.reply({
                    embeds: [ctx.embed({ title: "🧩 Commandes personnalisées", description: "Aucune commande personnalisée configurée." })],
                });
                return;
            }

            const lines = rows.map((r) => `\`${r.name}\` → ${r.response.length > 80 ? `${r.response.slice(0, 80)}…` : r.response}`);
            const chunks = chunk(lines, PAGE_SIZE);
            const pages = chunks.map((c, i) =>
                ctx.embed({
                    title: `🧩 Commandes personnalisées (page ${i + 1}/${chunks.length})`,
                    description: listField(c, { limit: PAGE_SIZE }),
                })
            );

            await paginate(ctx.message, pages);
        } else {
            throw new UsageError("custom <add <nom> <réponse...> | remove <nom> | list>");
        }
    },
};
