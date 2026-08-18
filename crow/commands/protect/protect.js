"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

const GUARD_LABELS = {
    antiban: "Anti-ban",
    antibot: "Anti-bots",
    antichannel: "Anti-salons",
    antideco: "Anti-déconnexion",
    antieveryone: "Anti-everyone",
    antirole: "Anti-rôles",
    antiunban: "Anti-débannissement",
    antiwebhook: "Anti-webhooks",
};
const GUARD_KEYS = Object.keys(GUARD_LABELS);

module.exports = {
    name: "protect",
    category: "protect",
    description: "Gère les fonctionnalités de sécurité globales.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const sub = (ctx.args[0] || "").toLowerCase();

        if (sub === "on" || sub === "off") {
            const enabled = sub === "on";
            for (const key of GUARD_KEYS) {
                guardConfigRepo.setEnabled(ctx.guildId, ctx.identity.key, key, enabled);
            }
            await ctx.reply(
                enabled
                    ? "✅ Toutes les gardes CrowPROTECT ont été activées."
                    : "❌ Toutes les gardes CrowPROTECT ont été désactivées."
            );
            return;
        }

        const lines = GUARD_KEYS.map((key) => {
            const config = guardConfigRepo.getConfig(ctx.guildId, ctx.identity.key, key);
            return `${config?.enabled ? "✅" : "❌"} ${GUARD_LABELS[key]} (\`${key}\`)`;
        });

        const embed = ctx.embed({
            title: "🛡️ CrowPROTECT — Statut des gardes",
            description:
                lines.join("\n") +
                "\n\nUtilise `protect on`/`protect off` pour tout activer/désactiver d'un coup, ou les commandes individuelles (`antiban`, `antirole`...) pour chaque garde.",
        });
        await ctx.reply({ embeds: [embed] });
    },
};
