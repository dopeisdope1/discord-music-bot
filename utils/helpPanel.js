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
const { can } = require("./permissions/engine");
const { categoriesFor } = require("./commandCatalog");

const SELECT_ID = "help_nav";
const HOME = "__home__";
const MAX_BODY = 3500;

function formatCommand(cmd, prefixes) {
  // Les entrées sans préfixe (boutons, déclencheurs sans préfixe) sont
  // affichées telles quelles, sans back-tick trompeur devant.
  const prefix = cmd.prefix === "main" ? prefixes.main : cmd.prefix === "mod" ? prefixes.musicMod : "";
  const label = cmd.prefix ? `\`${prefix}${cmd.name}\`` : `**${cmd.name}**`;
  return `${label} — ${cmd.description}`;
}

// Nom court affiché dans les listes en ligne : sans les arguments pour une
// commande préfixée ("play <titre>" -> "play"), mais intégral pour les
// entrées sans préfixe, dont le nom EST la formulation ("uo clear").
const shortName = (cmd) => (cmd.prefix ? cmd.name.split(/\s+/)[0] : cmd.name);

function homeBody(categories, prefixes) {
  const lines = categories.map((c) => {
    const names = [...new Set(c.commands.map(shortName))];
    return `**${c.label} (${names.length}) :** ${names.join(", ")}`;
  });

  return [
    "Bienvenue sur le **panel d'aide** du bot",
    "Sélectionne une **catégorie** via le menu ci-dessous pour découvrir tes commandes disponibles",
    "Cette liste dépend de TES droits réels — le même système que le panel de configuration " +
      "(voir `&panel` > Permissions) : ce que tu vois ici, tu peux réellement l'utiliser.",
    "Les arguments entre `[]` sont **facultatifs**, les arguments entre `<>` sont **obligatoires**",
    "",
    ...lines,
    "",
    `Préfixe musique : \`${prefixes.main}\` · préfixe commandes : \`${prefixes.musicMod}\``,
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
        .setValue(HOME)
        .setDefault(current === HOME),
      ...categories.map((c) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(c.label)
          .setDescription(`${c.commands.length} commande(s)`)
          .setValue(c.key)
          .setDefault(current === c.key)
      ),
    ]);
}

/**
 * Panneau d'aide filtré sur les droits RÉELS de la personne — même moteur
 * que les commandes et le panel (utils/permissions/engine.js), pas une
 * liste séparée qui pourrait diverger (section 10/35 du cahier des
 * charges). Components V2 sans setAccentColor : pas de barre de couleur
 * sur le côté.
 * @param {string} guildId
 * @param {import('discord.js').GuildMember} member qui consulte l'aide
 * @param {string} [current]
 */
function buildHelpPanel(guildId, member, current = HOME) {
  const prefixes = getPrefixes(guildId);
  const categories = categoriesFor((permission) => can(member, permission));
  const category = categories.find((c) => c.key === current);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      category ? `## Aide — ${category.label}` : "## Aide"
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
