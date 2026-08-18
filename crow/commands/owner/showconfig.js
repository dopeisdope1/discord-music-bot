"use strict";

const guildSettingsRepo = require("../../db/repositories/guildSettingsRepo");
const permissionRepo = require("../../db/repositories/permissionRepo");
const logsConfigRepo = require("../../db/repositories/logsConfigRepo");
const { LEVEL, LEVEL_NAMES } = require("../../core/permissions/permissionLevels");
const { listField } = require("../../utils/embeds");

module.exports = {
    name: "showconfig",
    category: "owner",
    description: "Affiche l'intégralité de la configuration active.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const settings = guildSettingsRepo.getSettings(ctx.guildId, ctx.identity.key);
        const roles = permissionRepo.listRoles(ctx.guildId);
        const logs = logsConfigRepo.listAll(ctx.guildId, ctx.identity.key);

        const roleLines = roles
            .sort((a, b) => b.level - a.level)
            .map((r) => `<@&${r.role_id}> → **${LEVEL_NAMES[r.level]}**`);
        const logLines = logs.map((l) => `\`${l.log_type}\` → <#${l.channel_id}>`);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: `🗂️ Configuration complète — ${ctx.identity.displayName}`,
                    fields: [
                        {
                            name: "Général",
                            value: [
                                `Préfixe : ${settings?.prefix || ctx.identity.defaultPrefix || "(défaut)"}`,
                                `Langue : ${settings?.lang || "fr"}`,
                                `Logs activés : ${settings?.logs_master_enabled ? "✅" : "❌"}`,
                                `Automod : ${settings?.automod_enabled ? "✅" : "❌"}`,
                            ].join("\n"),
                        },
                        { name: "Permissions par rôle", value: listField(roleLines) },
                        { name: "Salons de logs", value: listField(logLines) },
                        { name: "Anti-raid", value: "Voir `+antiraid` pour la configuration anti-raid (non incluse ici)." },
                    ],
                }),
            ],
        });
    },
};
