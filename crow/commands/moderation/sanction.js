"use strict";

const sanctionsRepo = require("../../db/repositories/sanctionsRepo");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");
const { paginate } = require("../../utils/pagination");

const PAGE_SIZE = 10;

module.exports = {
    name: "sanction",
    category: "moderation",
    description: "Affiche l'historique des sanctions d'un membre.",
    permLevel: LEVEL.STAFF,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("sanction @user");

        const list = sanctionsRepo.listByTarget(ctx.guildId, targetId);

        if (!list.length) {
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "📋 Historique des sanctions",
                        description: "Aucune sanction enregistrée pour ce membre.",
                    }),
                ],
            });
            return;
        }

        const chunks = [];
        for (let i = 0; i < list.length; i += PAGE_SIZE) {
            chunks.push(list.slice(i, i + PAGE_SIZE));
        }

        const pages = chunks.map((chunk, pageIndex) => {
            const lines = chunk.map((s) => {
                const ts = Math.floor(s.created_at / 1000);
                const status = s.active ? "Active" : "Inactive";
                return `#${s.id} • **${s.type}** • ${status} — ${s.reason || "Aucune raison"} (<t:${ts}:d>)`;
            });

            return ctx.embed({
                title: `📋 Sanctions de <@${targetId}> (page ${pageIndex + 1}/${chunks.length})`,
                description: lines.join("\n"),
            });
        });

        await paginate(ctx.message, pages);
    },
};
