"use strict";

const guildSettingsRepo = require("../../db/repositories/guildSettingsRepo");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "settings",
    category: "owner",
    description: "Affiche la configuration générale de CrowALL.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const settings = guildSettingsRepo.getSettings(ctx.guildId, ctx.identity.key);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: `⚙️ Configuration — ${ctx.identity.displayName}`,
                    fields: [
                        { name: "Préfixe", value: settings?.prefix || ctx.identity.defaultPrefix || "(défaut)", inline: true },
                        { name: "Couleur du thème", value: settings?.theme_color || ctx.identity.themeColor || "(défaut)", inline: true },
                        { name: "Langue", value: settings?.lang || "fr", inline: true },
                        { name: "Logs activés", value: settings?.logs_master_enabled ? "✅ Oui" : "❌ Non", inline: true },
                        { name: "Automod activé", value: settings?.automod_enabled ? "✅ Oui" : "❌ Non", inline: true },
                    ],
                    footer: settings ? undefined : "Aucun paramètre personnalisé enregistré, valeurs par défaut affichées.",
                }),
            ],
        });
    },
};
