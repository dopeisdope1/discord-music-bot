"use strict";

const {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    MessageFlags,
} = require("discord.js");
const { loadCommandsForIdentity } = require("../../core/commandLoader");
const messageRouter = require("../../core/messageRouter");
const identities = require("../../identities");
const { registerButtonHandler } = require("../../core/interactionRegistry");
const { labelOf, emojiOf } = require("../../utils/categoryLabels");

// Préfixe d'interaction propre : "panel" est déjà pris par
// services/panelService.js (le panneau de config admin), et le registre
// dispatche sur le segment avant ":".
const ID = "hpanel";

const HOME = "__home__";

// Composants V2 : une page = un seul message édité en place. La limite dure
// est de 4000 caractères tous TextDisplay confondus, d'où la troncature.
const MAX_BODY = 3500;

function commandsByCategory(identity) {
    const registry = loadCommandsForIdentity(identity);
    const commands = [...new Set(registry.values())];
    const byCategory = new Map();
    for (const cmd of commands) {
        if (!byCategory.has(cmd.category)) byCategory.set(cmd.category, []);
        byCategory.get(cmd.category).push(cmd);
    }
    for (const list of byCategory.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return byCategory;
}

const sortedCategories = (byCategory) => [...byCategory.keys()].sort((a, b) => labelOf(a).localeCompare(labelOf(b)));

function buildSelect(identityKey, byCategory, current) {
    const options = [
        new StringSelectMenuOptionBuilder()
            .setLabel("Accueil")
            .setDescription("Vue d'ensemble de toutes les catégories")
            .setEmoji("🏠")
            .setValue(HOME)
            .setDefault(current === HOME),
        ...sortedCategories(byCategory).map((category) =>
            new StringSelectMenuOptionBuilder()
                .setLabel(labelOf(category))
                .setDescription(`${byCategory.get(category).length} commande(s)`)
                .setEmoji(emojiOf(category))
                .setValue(category)
                .setDefault(current === category)
        ),
    ];

    return new StringSelectMenuBuilder()
        .setCustomId(`${ID}:${identityKey}:nav`)
        .setPlaceholder("Choisis une catégorie")
        .addOptions(options);
}

function homeBody(byCategory, total, prefix) {
    const lines = sortedCategories(byCategory).map(
        (c) => `${emojiOf(c)} **${labelOf(c)}** — ${byCategory.get(c).length} commande(s)`
    );
    return (
        `**${total}** commandes réparties en **${byCategory.size}** catégories.\n` +
        `Sélectionne une catégorie dans le menu ci-dessous pour voir le détail.\n\n` +
        lines.join("\n") +
        `\n\nPréfixe actuel : \`${prefix}\``
    );
}

function categoryBody(category, commands, prefix) {
    let body = "";
    let truncated = 0;
    for (const cmd of commands) {
        const line = `\`${prefix}${cmd.name}\` — ${cmd.description || "Pas de description."}\n`;
        if (body.length + line.length > MAX_BODY) {
            truncated += 1;
            continue;
        }
        body += line;
    }
    if (truncated) body += `\n*… et ${truncated} autre(s), tape \`${prefix}helpall\`.*`;
    return body;
}

/**
 * Page du panel, en Components V2 et volontairement SANS setAccentColor :
 * pas de barre de couleur sur le côté.
 */
function buildPanelPage(identity, guildId, current = HOME) {
    const byCategory = commandsByCategory(identity);
    const total = [...byCategory.values()].reduce((n, list) => n + list.length, 0);
    const prefix = messageRouter.resolvePrefix(identity, guildId);

    const isHome = current === HOME || !byCategory.has(current);
    const container = new ContainerBuilder();

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            isHome
                ? `## ${identity.displayName} — Panneau des commandes`
                : `## ${emojiOf(current)} ${labelOf(current)}`
        )
    );
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            isHome ? homeBody(byCategory, total, prefix) : categoryBody(current, byCategory.get(current), prefix)
        )
    );
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addActionRowComponents(
        new ActionRowBuilder().addComponents(buildSelect(identity.key, byCategory, isHome ? HOME : current))
    );

    return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

module.exports = {
    name: "panel",
    category: "public",
    description: "Affiche le panneau des commandes, page par page.",
    permLevel: 0,
    aliases: ["menu"],
    async execute(ctx) {
        await ctx.send(buildPanelPage(ctx.identity, ctx.guildId));
    },
};

registerButtonHandler(ID, async (interaction) => {
    const identityKey = interaction.customId.split(":")[1];
    const identity = identities.find((i) => i.key === identityKey);
    if (!identity) return;

    // update() et pas reply() : on tourne les pages dans le message existant.
    await interaction
        .update(buildPanelPage(identity, interaction.guild.id, interaction.values[0]))
        .catch(() => {});
});

module.exports.buildPanelPage = buildPanelPage;
