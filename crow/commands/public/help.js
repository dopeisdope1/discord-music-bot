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
const messageRouter = require("../../core/messageRouter");
const identities = require("../../identities");
const { registerButtonHandler } = require("../../core/interactionRegistry");
const { labelOf, emojiOf } = require("../../utils/categoryLabels");
const { LEVELS, levelLabel, levelOf, usableBy } = require("../../utils/permView");
const { resolvePermission } = require("../../core/permissions/resolvePermission");
const { isBotOwner } = require("../../core/commandContext");

const HOME = "__home__";
const MAX_BODY = 3500;

function groupByCategory(commands) {
    const byCategory = new Map();
    for (const cmd of commands) {
        if (!byCategory.has(cmd.category)) byCategory.set(cmd.category, []);
        byCategory.get(cmd.category).push(cmd);
    }
    return byCategory;
}

const sortedCategories = (byCategory) => [...byCategory.keys()].sort((a, b) => labelOf(a).localeCompare(labelOf(b)));

function buildSelect(identityKey, byCategory, current) {
    const options = [
        new StringSelectMenuOptionBuilder()
            .setLabel("Accueil")
            .setDescription("Vue d'ensemble de tes commandes")
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
        .setCustomId(`help:${identityKey}`)
        .setPlaceholder("Naviguer vers une catégorie")
        .addOptions(options);
}

// Accueil : ce à quoi la personne a droit, regroupé par palier de permission.
function homeBody(commands, prefix) {
    const lines = [
        "Bienvenue sur le **panneau d'aide** du bot.",
        "Sélectionne une **catégorie** dans le menu ci-dessous pour voir tes commandes.",
        "Les arguments entre `[]` sont facultatifs, ceux entre `<>` sont obligatoires.",
        "",
    ];

    for (const level of LEVELS) {
        const names = commands.filter((c) => levelOf(c) === level).map((c) => c.name);
        if (!names.length) continue;
        lines.push(`**${levelLabel(level)} (${names.length})** : ${names.join(", ")}`);
    }

    lines.push("", `Préfixe : \`${prefix}\` — ${commands.length} commande(s) accessible(s).`);
    return lines.join("\n");
}

function categoryBody(commands, prefix) {
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
    if (truncated) body += `\n*… et ${truncated} autre(s).*`;
    return body;
}

/**
 * Panneau d'aide filtré sur les droits réels de `member`. Components V2 sans
 * setAccentColor : pas de barre de couleur.
 */
function buildHelpPanel(identity, guildId, member, current = HOME) {
    const permLevel = member ? resolvePermission(member) : 0;
    const commands = usableBy(identity, permLevel, isBotOwner(member?.id));
    const byCategory = groupByCategory(commands);
    const prefix = messageRouter.resolvePrefix(identity, guildId);

    const isHome = current === HOME || !byCategory.has(current);
    const container = new ContainerBuilder();

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            isHome ? `## Aide — ${identity.displayName}` : `## ${emojiOf(current)} Aide — ${labelOf(current)}`
        )
    );
    container.addSeparatorComponents(new SeparatorBuilder());
    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
            commands.length === 0
                ? "Tu n'as accès à aucune commande sur ce serveur."
                : isHome
                  ? homeBody(commands, prefix)
                  : categoryBody(byCategory.get(current), prefix)
        )
    );

    if (byCategory.size) {
        container.addSeparatorComponents(new SeparatorBuilder());
        container.addActionRowComponents(
            new ActionRowBuilder().addComponents(buildSelect(identity.key, byCategory, isHome ? HOME : current))
        );
    }

    return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

module.exports = {
    name: "help",
    category: "public",
    description: "Affiche les commandes que tu peux utiliser.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        await ctx.send(buildHelpPanel(ctx.identity, ctx.guildId, ctx.member));
    },
};

registerButtonHandler("help", async (interaction) => {
    const identity = identities.find((i) => i.key === interaction.customId.split(":")[1]);
    if (!identity) return;

    // Le panneau est recalculé pour QUI CLIQUE : deux membres de rangs
    // différents ne doivent pas voir la même liste. D'où la réponse éphémère
    // plutôt qu'une édition du message partagé.
    await interaction
        .reply({
            ...buildHelpPanel(identity, interaction.guild.id, interaction.member, interaction.values[0]),
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
        })
        .catch(() => {});
});

module.exports.buildHelpPanel = buildHelpPanel;
