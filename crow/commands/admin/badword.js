"use strict";

const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { listField } = require("../../utils/embeds");

module.exports = {
    name: "badword",
    category: "admin",
    description: "Gère la liste des mots interdits.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const sub = (ctx.args[0] || "").toLowerCase();
        const word = ctx.args[1]?.toLowerCase();

        if (sub === "add") {
            if (!word) throw new UsageError("badword add <mot>");
            ctx.db
                .prepare(
                    "INSERT OR IGNORE INTO badwords (guild_id, word, added_by, added_at) VALUES (?, ?, ?, ?)"
                )
                .run(ctx.guildId, word, ctx.author.id, Date.now());
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "🚫 Mot interdit ajouté",
                        description: `\`${word}\` a été ajouté à la liste des mots interdits.`,
                    }),
                ],
            });
            return;
        }

        if (sub === "remove") {
            if (!word) throw new UsageError("badword remove <mot>");
            ctx.db.prepare("DELETE FROM badwords WHERE guild_id = ? AND word = ?").run(ctx.guildId, word);
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "✅ Mot interdit retiré",
                        description: `\`${word}\` a été retiré de la liste des mots interdits.`,
                    }),
                ],
            });
            return;
        }

        if (sub === "list") {
            const words = ctx.db
                .prepare("SELECT word FROM badwords WHERE guild_id = ?")
                .all(ctx.guildId)
                .map((r) => r.word);
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "🚫 Mots interdits",
                        description: listField(words, { empty: "Aucun mot interdit configuré." }),
                    }),
                ],
            });
            return;
        }

        throw new UsageError("badword <add|remove|list> [mot]");
    },
};
