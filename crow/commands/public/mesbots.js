"use strict";

const identities = require("../../identities");
const { loadCommandsForIdentity } = require("../../core/commandLoader");
const { resolvePermission } = require("../../core/permissions/resolvePermission");
const { paginate } = require("../../utils/pagination");

// Cross-bot view: permission levels are guild-scoped and shared across all 5
// identities (see permission_roles/permission_users — no identity_key column),
// so resolving the level once and filtering each bot's registry against it is
// correct, not an approximation.
module.exports = {
    name: "mesbots",
    category: "public",
    description: "Affiche toutes les commandes accessibles, sur les 5 bots Crow, à ton niveau de permission actuel.",
    permLevel: 0,
    async execute(ctx) {
        const userLevel = resolvePermission(ctx.member);

        const pages = [];
        for (const identity of identities) {
            const registry = loadCommandsForIdentity(identity);
            const accessible = [...new Set(registry.values())]
                .filter((cmd) => ctx.botOwner || (cmd.permLevel ?? 0) <= userLevel)
                .map((cmd) => cmd.name)
                .sort();

            if (accessible.length === 0) continue;

            pages.push(
                ctx.embed({
                    title: `${identity.displayName} — préfixe \`${identity.defaultPrefix}\``,
                    description: `${accessible.length} commande(s) accessible(s) :\n\`\`\`${accessible.join(", ")}\`\`\``,
                    color: identity.themeColor,
                    footer: `Ton niveau de permission : ${userLevel}/3`,
                })
            );
        }

        if (pages.length === 0) {
            return ctx.reply("Tu n'as accès à aucune commande sur les bots Crow.");
        }

        await paginate(ctx.message, pages);
    },
};
