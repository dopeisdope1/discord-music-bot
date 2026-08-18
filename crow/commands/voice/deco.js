"use strict";

const voiceRepo = require("../../db/repositories/voiceRepo");
const { LEVEL } = require("../../core/permissions/permissionLevels");

// Toggles the deco_mode flag on voice_config. NOTE: this only flips the
// stored flag — lock/pv don't yet branch on it to disconnect vs. move members.
// Wiring that behavior into lock.js/pv.js is left for a follow-up.
module.exports = {
    name: "deco",
    category: "voice",
    description: "Déconnecte les membres au lieu de les déplacer (lock/pv).",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        voiceRepo.ensureConfig(ctx.guildId);
        const config = voiceRepo.getConfig(ctx.guildId);
        const next = config?.deco_mode ? 0 : 1;
        voiceRepo.setConfigField(ctx.guildId, "deco_mode", next);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🔌 Mode déconnexion",
                    description: next
                        ? "Les membres seront désormais **déconnectés** au lieu d'être déplacés."
                        : "Les membres seront désormais **déplacés** au lieu d'être déconnectés.",
                }),
            ],
        });
    },
};
