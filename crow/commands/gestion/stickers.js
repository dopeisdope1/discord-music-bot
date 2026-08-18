"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { paginate } = require("../../utils/pagination");
const { chunk } = require("../../utils/embeds");

// Adding a NEW sticker needs a file upload, impractical from a text command —
// only list/remove are implemented here, see final report.
module.exports = {
    name: "stickers",
    category: "gestion",
    description: "Gère les autocollants personnalisés.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const sub = (ctx.args[0] || "list").toLowerCase();

        if (sub === "list") {
            const stickers = [...ctx.guild.stickers.cache.values()];
            if (!stickers.length) {
                await ctx.reply({
                    embeds: [
                        ctx.embed({
                            title: "🏷️ Autocollants",
                            description: "Aucun autocollant personnalisé.",
                        }),
                    ],
                });
                return;
            }

            const lines = stickers.map((s) => `${s.name} — \`${s.id}\``);
            const groups = chunk(lines, 20);
            const pages = groups.map((group, i) =>
                ctx.embed({
                    title: `🏷️ Autocollants (${stickers.length})`,
                    description: group.join("\n"),
                    footer: `Page ${i + 1}/${groups.length} — ajout non supporté (upload requis)`,
                })
            );

            await paginate(ctx.message, pages);
            return;
        }

        if (sub === "remove") {
            const id = ctx.args[1];
            if (!id) throw new UsageError("stickers remove <id>");

            const sticker = ctx.guild.stickers.cache.get(id);
            if (!sticker) throw new BotError("Autocollant introuvable sur ce serveur.");

            try {
                await ctx.guild.stickers.delete(id);
            } catch (error) {
                throw new BotError(`Impossible de supprimer cet autocollant : ${error.message}`);
            }

            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "🗑️ Autocollant supprimé",
                        description: `**${sticker.name}** a été supprimé.`,
                    }),
                ],
            });
            return;
        }

        throw new UsageError("stickers <list|remove [id]>");
    },
};
