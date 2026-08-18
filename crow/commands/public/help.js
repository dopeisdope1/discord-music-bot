"use strict";

const { StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ActionRowBuilder } = require("discord.js");
const { loadCommandsForIdentity } = require("../../core/commandLoader");
const messageRouter = require("../../core/messageRouter");
const identities = require("../../identities");
const { registerButtonHandler } = require("../../core/interactionRegistry");

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

function buildCategorySelect(identityKey, counts) {
    return new StringSelectMenuBuilder()
        .setCustomId(`help:${identityKey}`)
        .setPlaceholder("📂 Naviguer vers une catégorie")
        .addOptions(
            [...counts.entries()]
                .sort((a, b) => a[0].localeCompare(b[0]))
                .map(([category, count]) =>
                    new StringSelectMenuOptionBuilder()
                        .setLabel(CATEGORY_LABELS[category] || category)
                        .setDescription(`${count} commande${count > 1 ? "s" : ""}`)
                        .setValue(category)
                )
        );
}

module.exports = {
    name: "help",
    category: "public",
    description: "Affiche le menu d'aide général.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const registry = loadCommandsForIdentity(ctx.identity);
        const commands = [...new Set(registry.values())];

        const counts = new Map();
        for (const cmd of commands) {
            counts.set(cmd.category, (counts.get(cmd.category) || 0) + 1);
        }

        const prefix = messageRouter.resolvePrefix(ctx.identity, ctx.guildId);

        const fields = [...counts.entries()]
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([category, count]) => ({
                name: CATEGORY_LABELS[category] || category,
                value: `${count} commande${count > 1 ? "s" : ""}`,
                inline: true,
            }));

        await ctx.send({
            embeds: [
                ctx.embed({
                    title: `📖 Aide — ${ctx.identity.displayName}`,
                    description: "Catégories de commandes disponibles sur ce serveur. Choisis-en une ci-dessous pour voir le détail.",
                    fields,
                    footer: `Préfixe : ${prefix} | Liste complète : ${prefix}helpall`,
                }),
            ],
            components: [new ActionRowBuilder().addComponents(buildCategorySelect(ctx.identity.key, counts))],
        });
    },
};

registerButtonHandler("help", async (interaction) => {
    const identityKey = interaction.customId.split(":")[1];
    const identity = identities.find((i) => i.key === identityKey);
    if (!identity) return;

    const category = interaction.values[0];
    const registry = loadCommandsForIdentity(identity);
    const commands = [...new Set(registry.values())]
        .filter((cmd) => cmd.category === category)
        .sort((a, b) => a.name.localeCompare(b.name));

    const prefix = messageRouter.resolvePrefix(identity, interaction.guild.id);
    const lines = commands.map((cmd) => `\`${prefix}${cmd.name}\` — ${cmd.description || "Pas de description."}`);

    await interaction.reply({
        content: `**${CATEGORY_LABELS[category] || category}** (${commands.length})\n${lines.join("\n")}`,
        ephemeral: true,
    });
});
