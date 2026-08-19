const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} = require("discord.js");
const { getPrefixes } = require("./prefixStore");
const accessStore = require("./accessStore");
const { categoriesFor } = require("./commandCatalog");

const SELECT_ID = "help_nav";
const HOME = "__home__";
const MAX_BODY = 3500;

/** Ce que la personne peut utiliser, selon la portée exigée par la commande. */
function accessChecker(userId) {
  return (scope) => {
    if (!scope) return true;
    if (scope === "owner") return accessStore.isOwner(userId);
    return accessStore.isAllowed(scope, userId);
  };
}

function formatCommand(cmd, prefixes) {
  // Les entrées sans préfixe (boutons, déclencheurs sans préfixe) sont
  // affichées telles quelles, sans back-tick trompeur devant.
  const prefix = cmd.prefix === "main" ? prefixes.main : cmd.prefix === "mod" ? prefixes.musicMod : "";
  const label = cmd.prefix ? `\`${prefix}${cmd.name}\`` : `**${cmd.name}**`;
  return `${label} — ${cmd.description}`;
}

function homeBody(categories, prefixes) {
  const total = categories.reduce((n, c) => n + c.commands.length, 0);
  const lines = categories.map((c) => `${c.emoji} **${c.label}** — ${c.commands.length} commande(s)`);

  return [
    "Sélectionne une **catégorie** dans le menu ci-dessous pour voir le détail.",
    "Les arguments entre `[]` sont facultatifs, ceux entre `<>` sont obligatoires.",
    "",
    ...lines,
    "",
    `Préfixe musique : \`${prefixes.main}\` · préfixe commandes : \`${prefixes.musicMod}\``,
    `${total} commande(s) accessible(s) pour toi.`,
  ].join("\n");
}

function categoryBody(category, prefixes) {
  let body = "";
  let skipped = 0;
  for (const cmd of category.commands) {
    const line = `${formatCommand(cmd, prefixes)}\n`;
    if (body.length + line.length > MAX_BODY) {
      skipped += 1;
      continue;
    }
    body += line;
  }
  if (skipped) body += `\n*… et ${skipped} autre(s).*`;
  return body;
}

function buildSelect(categories, current) {
  return new StringSelectMenuBuilder()
    .setCustomId(SELECT_ID)
    .setPlaceholder("Naviguer vers une catégorie")
    .addOptions([
      new StringSelectMenuOptionBuilder()
        .setLabel("Accueil")
        .setDescription("Vue d'ensemble")
        .setEmoji("🏠")
        .setValue(HOME)
        .setDefault(current === HOME),
      ...categories.map((c) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(c.label)
          .setDescription(`${c.commands.length} commande(s)`)
          .setEmoji(c.emoji)
          .setValue(c.key)
          .setDefault(current === c.key)
      ),
    ]);
}

/**
 * Panneau d'aide filtré sur les droits réels de la personne. Components V2
 * sans setAccentColor : pas de barre de couleur sur le côté.
 */
function buildHelpPanel(guildId, userId, current = HOME) {
  const prefixes = getPrefixes(guildId);
  const categories = categoriesFor(accessChecker(userId));
  const category = categories.find((c) => c.key === current);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      category ? `## ${category.emoji} Aide — ${category.label}` : "## Aide"
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      category ? categoryBody(category, prefixes) : homeBody(categories, prefixes)
    )
  );

  if (categories.length) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(buildSelect(categories, category ? current : HOME))
    );
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

module.exports = { buildHelpPanel, SELECT_ID };
