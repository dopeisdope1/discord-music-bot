"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractRoleId } = require("../../utils/args");

// Config-only: stores which role/keyword to use for the "soutien" (supporter)
// role. Live detection of a member's custom status requires the privileged
// GuildPresences intent, which is deliberately NOT enabled on any identity in
// this project (minimizes privileged-intent footprint) — so nothing actually
// grants the role automatically yet, this only manages the config.
const NOTE = "⚠️ La détection automatique du statut personnalisé n'est pas active (intent GuildPresences désactivé) — seule la configuration est enregistrée.";

module.exports = {
    name: "soutien",
    category: "owner",
    description: "Gère le rôle soutien en cas de statut personnalisé.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const sub = ctx.args[0]?.toLowerCase();
        const usage = "soutien <setrole @role | setkeyword <mot> | show>";

        if (sub === "setrole") {
            const roleId = extractRoleId(ctx.args[1]);
            if (!roleId) throw new UsageError(usage);

            const existing = ctx.db.prepare("SELECT keyword FROM soutien_config WHERE guild_id = ?").get(ctx.guildId);
            ctx.db
                .prepare(
                    `INSERT INTO soutien_config (guild_id, role_id, keyword) VALUES (?, ?, ?)
                     ON CONFLICT(guild_id) DO UPDATE SET role_id = excluded.role_id`
                )
                .run(ctx.guildId, roleId, existing?.keyword ?? null);

            await ctx.reply(`✅ Rôle soutien défini sur <@&${roleId}>.\n${NOTE}`);
        } else if (sub === "setkeyword") {
            const keyword = ctx.args.slice(1).join(" ");
            if (!keyword) throw new UsageError(usage);

            const existing = ctx.db.prepare("SELECT role_id FROM soutien_config WHERE guild_id = ?").get(ctx.guildId);
            if (!existing) throw new BotError("Configure d'abord le rôle avec `soutien setrole @role`.");

            ctx.db.prepare("UPDATE soutien_config SET keyword = ? WHERE guild_id = ?").run(keyword, ctx.guildId);

            await ctx.reply(`✅ Mot-clé soutien défini sur \`${keyword}\`.\n${NOTE}`);
        } else {
            const config = ctx.db.prepare("SELECT * FROM soutien_config WHERE guild_id = ?").get(ctx.guildId);

            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "💛 Configuration soutien",
                        description: NOTE,
                        fields: [
                            { name: "Rôle", value: config?.role_id ? `<@&${config.role_id}>` : "Non configuré", inline: true },
                            { name: "Mot-clé", value: config?.keyword || "Non configuré", inline: true },
                        ],
                    }),
                ],
            });
        }
    },
};
