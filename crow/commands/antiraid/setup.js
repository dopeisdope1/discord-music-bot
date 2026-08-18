"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

const GUARD_LABELS = {
    antirole: "Anti-rôles",
    antiban: "Anti-ban",
    antibot: "Anti-bots",
    antichannel: "Anti-salons",
    antideco: "Anti-déconnexion",
    antieveryone: "Anti-everyone",
    antiwebhook: "Anti-webhooks",
    antijoin: "Anti-raid (arrivée massive)",
    antikick: "Anti-kick",
    antilink: "Anti-liens",
    antiupdate: "Anti-modification",
};

// A guided multi-step wizard is out of scope for a single message/response bot —
// this is a single summary embed plus a pointer to the individual toggle
// commands / `antiraid on`.
module.exports = {
    name: "setup",
    category: "antiraid",
    description: "Démarre la configuration antiraid guidée.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const lines = Object.entries(GUARD_LABELS).map(([key, label]) => {
            const config = guardConfigRepo.getConfig(ctx.guildId, ctx.identity.key, key);
            return `${config?.enabled ? "✅" : "❌"} ${label} (\`${key}\`)`;
        });

        const embed = ctx.embed({
            title: "🛡️ Configuration antiraid",
            description:
                lines.join("\n") +
                "\n\nUtilise les commandes individuelles (ex : `antiban`, `antirole`...) pour activer/désactiver chaque garde, ou `antiraid on` pour tout activer d'un coup.",
        });
        await ctx.reply({ embeds: [embed] });
    },
};
