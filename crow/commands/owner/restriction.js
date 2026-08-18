"use strict";

const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractRoleId, extractChannelId } = require("../../utils/args");
const { listField } = require("../../utils/embeds");

// Config storage only. NOTE: enforcing these restrictions inside
// core/messageRouter.js is NOT built yet — this only stores/lists them.
module.exports = {
    name: "restriction",
    category: "owner",
    description: "Configure les restrictions de rôles et de salons.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const sub = ctx.args[0]?.toLowerCase();
        const usage = "restriction <add|remove> <role|channel> <@role|#salon> <commande> | restriction list";

        if (sub === "add" || sub === "remove") {
            const type = ctx.args[1]?.toLowerCase();
            if (!["role", "channel"].includes(type)) throw new UsageError(usage);

            const entityId = type === "role" ? extractRoleId(ctx.args[2]) : extractChannelId(ctx.args[2]);
            const commandName = ctx.args.slice(3).join(" ").toLowerCase();
            if (!entityId || !commandName) throw new UsageError(usage);

            if (sub === "add") {
                ctx.db
                    .prepare(
                        "INSERT OR IGNORE INTO restrictions (guild_id, entity_type, entity_id, command_name) VALUES (?, ?, ?, ?)"
                    )
                    .run(ctx.guildId, type, entityId, commandName);

                await ctx.reply(
                    `✅ Restriction ajoutée : \`${commandName}\` est désormais restreinte pour ${type === "role" ? `<@&${entityId}>` : `<#${entityId}>`}.\n⚠️ Rappel : l'application effective de cette restriction n'est pas encore active dans le routeur de commandes.`
                );
            } else {
                const result = ctx.db
                    .prepare(
                        "DELETE FROM restrictions WHERE guild_id = ? AND entity_type = ? AND entity_id = ? AND command_name = ?"
                    )
                    .run(ctx.guildId, type, entityId, commandName);

                await ctx.reply(
                    Number(result.changes) > 0 ? "✅ Restriction retirée." : "❌ Aucune restriction correspondante trouvée."
                );
            }
        } else if (sub === "list") {
            const rows = ctx.db
                .prepare("SELECT entity_type, entity_id, command_name FROM restrictions WHERE guild_id = ?")
                .all(ctx.guildId);

            if (!rows.length) {
                await ctx.reply({
                    embeds: [ctx.embed({ title: "🚧 Restrictions", description: "Aucune restriction configurée." })],
                });
                return;
            }

            const lines = rows.map(
                (r) => `\`${r.command_name}\` — ${r.entity_type === "role" ? `<@&${r.entity_id}>` : `<#${r.entity_id}>`}`
            );

            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "🚧 Restrictions configurées",
                        description: listField(lines, { limit: 25 }),
                        footer: "L'application de ces restrictions n'est pas encore active.",
                    }),
                ],
            });
        } else {
            throw new UsageError(usage);
        }
    },
};
