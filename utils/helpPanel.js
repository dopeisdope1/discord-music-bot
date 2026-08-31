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
const { isImplemented } = require("./implementedCommands");

const SELECT_ID = "help_nav";
const HOME = "__home__";

/**
 * Identité d'affichage d'une commande : tous les mots de TÊTE qui sont de
 * vrais mots du déclencheur (pas un argument) — même logique que
 * utils/implementedCommands.js::isImplemented, pour rester cohérent avec ce
 * qui est réellement routé. Sans ça, "role create", "role delete", "role
 * rename", "role color" et "role admin" fusionnaient tous sous le seul mot
 * ambigu "role" : cinq commandes différentes affichées comme une seule,
 * sans dire lesquelles existent ni comment les taper — la cause principale
 * du "&help incompréhensible" signalé.
 * @param {{ name: string, prefix?: string }} cmd
 */
function leadingWords(cmd) {
  if (!cmd.prefix) return [cmd.name];
  const words = cmd.name.trim().split(/\s+/);
  const lead = [];
  for (const w of words) {
    if (/^[a-z]+$/i.test(w)) lead.push(w.toLowerCase());
    else break;
  }
  return lead.length ? lead : [words[0]];
}
const identityOf = (cmd) => leadingWords(cmd).join(" ");

/** Une ligne par commande : syntaxe complète + description, alias visibles. */
function formatEntry(cmd) {
  const aliasNote = cmd.aliases?.length ? ` *(alias : ${cmd.aliases.join(", ")})*` : "";
  return `\`${cmd.name}\`${aliasNote} — ${cmd.description}`;
}

// Groupe par palier d'accès plutôt que par catégorie ou en détaillant chaque
// commande (syntaxe + description) : liste compacte de noms, comme la
// référence CrowBot — beaucoup plus court une fois le catalogue élargi à des
// dizaines de commandes par catégorie (repère : ~2500 caractères sur
// l'accueil avant ce changement, contre quelques centaines maintenant). Le
// détail (syntaxe précise) reste dans la rubrique de chaque catégorie
// plutôt que d'alourdir cette vue.
function tierOf(cmd) {
  if (cmd.permission === "sys") return "sys";
  if (cmd.permission == null) return "public";
  return "configurable";
}

const TIER_LABELS = { public: "Commandes publiques", configurable: "Commandes configurables", sys: "Commandes Sys" };

function tieredBody(commands) {
  const groups = { public: [], configurable: [], sys: [] };
  // Les commandes seulement DOCUMENTÉES sont mises à part : les afficher au
  // milieu des autres revenait à promettre qu'elles répondent, alors que les
  // taper ne produit rien (voir utils/implementedCommands.js).
  const documented = [];
  for (const cmd of commands) {
    if (isImplemented(cmd)) groups[tierOf(cmd)].push(cmd);
    else documented.push(cmd);
  }

  // Une identité (ex: "role create") ne peut apparaître qu'une fois — garde-
  // fou pour un doublon accidentel dans le catalogue, pas un mécanisme de
  // fusion : chaque sous-commande garde sa propre ligne désormais.
  const placed = new Set();
  const sections = [];
  for (const tier of ["public", "configurable", "sys"]) {
    const entries = [];
    for (const cmd of groups[tier]) {
      const id = identityOf(cmd);
      if (placed.has(id)) continue;
      placed.add(id);
      entries.push(formatEntry(cmd));
    }
    if (!entries.length) continue;
    sections.push(`**${TIER_LABELS[tier]} (${entries.length})**\n${entries.join("\n")}`);
  }

  const documentedNames = [...new Set(documented.map(identityOf))].filter((n) => !placed.has(n));
  if (documentedNames.length) {
    sections.push(
      `*Documentées, pas encore actives (${documentedNames.length}) — les taper ne fait rien pour l'instant :*\n*${documentedNames.join(", ")}*`
    );
  }
  return sections.join("\n\n");
}

/** @returns {{ actives: number, total: number }} pour l'accueil et le menu. */
function countsOf(category) {
  const actives = category.commands.filter(isImplemented).length;
  return { actives, total: category.commands.length };
}

function homeBody(categories, prefixes) {
  // Un catalogue de cette taille (~190 commandes visibles pour le
  // propriétaire) reste trop long même regroupé par palier sur une seule
  // vue — la liste complète (aussi compacte que la référence) vit dans
  // chaque catégorie (voir categoryBody), l'accueil ne fait que résumer.
  const lines = categories.map((c) => {
    const { actives, total } = countsOf(c);
    return `> **${c.label}** — ${actives} active(s)${actives < total ? ` sur ${total} documentées` : ""}`;
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

function categoryBody(category) {
  return tieredBody(category.commands);
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
      ...categories.map((c) => {
        const { actives, total } = countsOf(c);
        return new StringSelectMenuOptionBuilder()
          .setLabel(c.label)
          .setDescription(actives < total ? `${actives} active(s) sur ${total}` : `${actives} commande(s)`)
          .setValue(c.key)
          .setDefault(current === c.key);
      }),
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
      category ? categoryBody(category) : homeBody(categories, prefixes)
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
