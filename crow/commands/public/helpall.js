"use strict";

const { loadCommandsForIdentity } = require("../../core/commandLoader");
const messageRouter = require("../../core/messageRouter");
const { paginate } = require("../../utils/pagination");

const CATEGORY_LABELS = {
    admin: "Administration",
    antiraid: "Anti-Raid",
    giveaway: "Giveaways",
    logs: "Logs",
    moderation: "Modération",
    owner: "Owner",
    gestion: "Gestion",
    public: "Public",
    protect: "Protect",
    limit: "Limit",
    blr: "BLR",
    bl: "Blacklist",
    laisse: "Laisse",
    voice: "Vocal",
};

const PAGE_SIZE = 20;

module.exports = {
    name: "helpall",
    category: "public",
    description: "Affiche toutes les commandes sans restriction.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const prefix = messageRouter.resolvePrefix(ctx.identity, ctx.guildId);
        const registry = loadCommandsForIdentity(ctx.identity);
        const commands = [...new Set(registry.values())].sort((a, b) => {
            if (a.category !== b.category) return a.category.localeCompare(b.category);
            return a.name.localeCompare(b.name);
        });

        const lines = [];
        let currentCategory = null;
        for (const cmd of commands) {
            if (cmd.category !== currentCategory) {
                currentCategory = cmd.category;
                lines.push(`\n**${CATEGORY_LABELS[currentCategory] || currentCategory}**`);
            }
            lines.push(`\`${prefix}${cmd.name}\` : ${cmd.description || "Pas de description."}`);
        }

        const chunks = [];
        let current = [];
        let currentLen = 0;
        for (const line of lines) {
            if (current.length >= PAGE_SIZE || currentLen + line.length > 3500) {
                chunks.push(current);
                current = [];
                currentLen = 0;
            }
            current.push(line);
            currentLen += line.length;
        }
        if (current.length) chunks.push(current);

        const pages = chunks.map((chunk) =>
            ctx.embed({
                title: `📖 Page d'aide — ${ctx.identity.displayName}`,
                description: `Liste des commandes disponibles (${commands.length}).\n${chunk.join("\n")}`,
            })
        );

        await paginate(ctx.message, pages);
    },
};
