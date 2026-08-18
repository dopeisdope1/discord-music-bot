"use strict";

const sanctionsRepo = require("../../db/repositories/sanctionsRepo");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { formatDuration } = require("../../utils/time");
const { paginate } = require("../../utils/pagination");

const PAGE_SIZE = 10;

module.exports = {
    name: "mutelist",
    category: "moderation",
    description: "Affiche la liste des utilisateurs muets.",
    permLevel: LEVEL.STAFF,
    aliases: [],
    async execute(ctx) {
        const mutes = sanctionsRepo.listActiveMutes(ctx.guildId);

        if (!mutes.length) {
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "🔇 Membres muets",
                        description: "Aucun membre actuellement muet.",
                    }),
                ],
            });
            return;
        }

        const chunks = [];
        for (let i = 0; i < mutes.length; i += PAGE_SIZE) {
            chunks.push(mutes.slice(i, i + PAGE_SIZE));
        }

        const pages = chunks.map((chunk, pageIndex) => {
            const lines = chunk.map((m) => {
                const remaining = m.expires_at ? formatDuration(m.expires_at - Date.now()) : "Permanent";
                return `<@${m.target_id}> — ${m.reason || "Aucune raison"} — ${remaining} (#${m.id})`;
            });

            return ctx.embed({
                title: `🔇 Membres muets (page ${pageIndex + 1}/${chunks.length})`,
                description: lines.join("\n"),
            });
        });

        await paginate(ctx.message, pages);
    },
};
