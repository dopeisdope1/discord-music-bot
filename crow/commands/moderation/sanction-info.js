"use strict";

const sanctionsRepo = require("../../db/repositories/sanctionsRepo");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { formatDuration } = require("../../utils/time");

module.exports = {
    name: "sanction-info",
    category: "moderation",
    description: "Affiche le détail d'une sanction.",
    permLevel: LEVEL.STAFF,
    aliases: [],
    async execute(ctx) {
        const id = Number(ctx.args[0]);
        if (!Number.isInteger(id) || id <= 0) throw new UsageError("sanction-info [ID]");

        const sanction = sanctionsRepo.getById(ctx.guildId, id);
        if (!sanction) throw new BotError("Sanction introuvable.");

        const createdTs = Math.floor(sanction.created_at / 1000);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: `📄 Sanction #${sanction.id}`,
                    fields: [
                        { name: "Cible", value: `<@${sanction.target_id}>`, inline: true },
                        { name: "Type", value: sanction.type, inline: true },
                        { name: "Statut", value: sanction.active ? "Active" : "Inactive", inline: true },
                        { name: "Raison", value: sanction.reason || "Aucune raison fournie", inline: false },
                        { name: "Modérateur", value: `<@${sanction.moderator_id}>`, inline: true },
                        { name: "Identité", value: sanction.issued_by_identity || "N/A", inline: true },
                        {
                            name: "Durée",
                            value: sanction.duration_ms ? formatDuration(sanction.duration_ms) : "Permanente",
                            inline: true,
                        },
                        {
                            name: "Expire",
                            value: sanction.expires_at ? `<t:${Math.floor(sanction.expires_at / 1000)}:R>` : "N/A",
                            inline: true,
                        },
                        { name: "Créée le", value: `<t:${createdTs}:f>`, inline: true },
                    ],
                }),
            ],
        });
    },
};
