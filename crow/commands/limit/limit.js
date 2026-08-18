"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const { UsageError } = require("../../core/errors");
const { extractRoleId } = require("../../utils/args");
const { getDb } = require("../../db/connection");

module.exports = {
    name: "limit",
    category: "limit",
    description: "Active ou désactive la limite d'action pour un rôle.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const db = getDb();

        if (!ctx.args[0]) {
            const rows = db
                .prepare(
                    "SELECT role_id, max_per_window, window_ms FROM role_limit_config WHERE guild_id = ? AND identity_key = ?"
                )
                .all(ctx.guildId, ctx.identity.key);

            if (rows.length === 0) {
                await ctx.reply("Aucun rôle limité actuellement.");
                return;
            }

            const lines = rows.map(
                (r) => `<@&${r.role_id}> — max **${r.max_per_window}** attribution(s) / **${r.window_ms / 1000}s**`
            );
            const embed = ctx.embed({
                title: "⏱️ Rôles limités",
                description: lines.join("\n"),
            });
            await ctx.reply({ embeds: [embed] });
            return;
        }

        const roleId = extractRoleId(ctx.args[0]);
        if (!roleId) throw new UsageError("limit @role [max] [fenêtre en secondes]");

        const existing = db
            .prepare("SELECT 1 FROM role_limit_config WHERE guild_id = ? AND identity_key = ? AND role_id = ?")
            .get(ctx.guildId, ctx.identity.key, roleId);

        if (existing) {
            db.prepare(
                "DELETE FROM role_limit_config WHERE guild_id = ? AND identity_key = ? AND role_id = ?"
            ).run(ctx.guildId, ctx.identity.key, roleId);
            await ctx.reply(`❌ Limite retirée pour <@&${roleId}>.`);
            return;
        }

        let maxPerWindow = 5;
        let windowMs = 10000;

        if (ctx.args[1]) {
            const parsedMax = Number.parseInt(ctx.args[1], 10);
            if (!Number.isInteger(parsedMax) || parsedMax <= 0) {
                throw new UsageError("limit @role [max] [fenêtre en secondes]");
            }
            maxPerWindow = parsedMax;
        }

        if (ctx.args[2]) {
            const parsedWindow = Number.parseInt(ctx.args[2], 10);
            if (!Number.isInteger(parsedWindow) || parsedWindow <= 0) {
                throw new UsageError("limit @role [max] [fenêtre en secondes]");
            }
            windowMs = parsedWindow * 1000;
        }

        db.prepare(
            "INSERT INTO role_limit_config (guild_id, identity_key, role_id, max_per_window, window_ms) VALUES (?, ?, ?, ?, ?)"
        ).run(ctx.guildId, ctx.identity.key, roleId, maxPerWindow, windowMs);

        await ctx.reply(
            `✅ Limite activée pour <@&${roleId}> : max **${maxPerWindow}** attribution(s) / **${windowMs / 1000}s**.`
        );
    },
};
