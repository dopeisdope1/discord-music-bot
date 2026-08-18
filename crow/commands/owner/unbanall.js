"use strict";

const moderationService = require("../../services/moderationService");
const { LEVEL } = require("../../core/permissions/permissionLevels");

// Cap per invocation to avoid hammering Discord's rate limits on large ban lists.
const MAX_PER_RUN = 50;

module.exports = {
    name: "unbanall",
    category: "owner",
    description: "Débannit l'intégralité des membres blacklistés.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const rows = ctx.db
            .prepare(
                "SELECT DISTINCT target_id FROM sanctions WHERE guild_id = ? AND type IN ('ban','tempban') AND active = 1"
            )
            .all(ctx.guildId);

        if (!rows.length) {
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "🔓 Débannissement massif",
                        description: "Aucun bannissement actif suivi par le bot n'a été trouvé.",
                    }),
                ],
            });
            return;
        }

        const truncated = rows.length > MAX_PER_RUN;
        const targets = rows.slice(0, MAX_PER_RUN);

        let success = 0;
        let fail = 0;
        for (const row of targets) {
            try {
                await moderationService.unban({ guild: ctx.guild, userId: row.target_id, reason: "unbanall" });
                success++;
            } catch {
                fail++;
            }
        }

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔓 Débannissement massif",
                    description: [
                        `✅ ${success} membre(s) débanni(s).`,
                        fail ? `❌ ${fail} échec(s).` : null,
                        truncated
                            ? `⚠️ ${rows.length - MAX_PER_RUN} bannissement(s) restant(s) n'ont pas été traités (limite de ${MAX_PER_RUN} par exécution) — relance la commande pour continuer.`
                            : null,
                    ]
                        .filter(Boolean)
                        .join("\n"),
                }),
            ],
        });
    },
};
