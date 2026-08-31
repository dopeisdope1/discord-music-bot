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

// Nom court affiché dans les listes en ligne : sans les arguments pour une
// commande préfixée ("play <titre>" -> "play"), mais intégral pour les
// entrées sans préfixe, dont le nom EST la formulation ("uo clear").
const baseName = (cmd) => (cmd.prefix ? cmd.name.split(/\s+/)[0] : cmd.name);

/**
 * Réduit une liste d'entrées du catalogue aux NOMS DE COMMANDES distincts.
 *
 * Deux sources de répétition à absorber, sans quoi la même commande occupe
 * plusieurs fois la ligne :
 *  - les sous-commandes d'un même dispatcher ("server", "server pic",
 *    "server banner" -> un seul "server") ;
 *  - les alias, qui ne sont plus des entrées à part et s'affichent collés à
 *    leur commande ("pic/avatar") — découvrables, sans laisser croire à deux
 *    fonctionnalités différentes.
 */
function commandNames(commands) {
  const aliases = new Map();
  for (const cmd of commands) {
    const base = baseName(cmd);
    if (!aliases.has(base)) aliases.set(base, new Set());
    for (const a of cmd.aliases || []) aliases.get(base).add(a);
  }
  return [...aliases].map(([base, alias]) => (alias.size ? `${base}/${[...alias].join("/")}` : base));
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

  // Un nom ne peut appartenir qu'à un seul palier : une commande dont les
  // sous-commandes ont des permissions différentes (&clear, &role) serait
  // sinon listée deux fois. Le palier le plus ouvert gagne, c'est celui qui
  // décrit ce que la personne peut réellement lancer.
  const placed = new Set();
  const sections = [];
  for (const tier of ["public", "configurable", "sys"]) {
    const names = commandNames(groups[tier]).filter((n) => !placed.has(n));
    if (!names.length) continue;
    for (const n of names) placed.add(n);
    sections.push(`**${TIER_LABELS[tier]} (${names.length}) :** ${names.join(", ")}`);
  }

  const documentedNames = commandNames(documented).filter((n) => !placed.has(n));
  if (documentedNames.length) {
    sections.push(
      `\n*Documentées, pas encore actives (${documentedNames.length}) — les taper ne fait rien pour l'instant :*\n*${documentedNames.join(", ")}*`
    );
  }
  return sections.join("\n");
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
