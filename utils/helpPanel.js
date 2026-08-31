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
 * utils/implementedCommands.js::isImplemented. Sans ça, "role create",
 * "role delete", "role rename"... fusionnaient tous sous le seul mot
 * ambigu "role" : impossible de savoir combien de commandes existaient
 * réellement ni comment les taper.
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

function tierOf(cmd) {
  if (cmd.permission === "sys") return "sys";
  if (cmd.permission == null) return "public";
  return "configurable";
}

const TIER_LABELS = { public: "Commandes publiques", configurable: "Commandes configurables", sys: "Commandes Sys" };

/**
 * Réduit une liste d'entrées du catalogue à des IDENTITÉS distinctes, alias
 * collés ("pic/avatar") — liste compacte, comme la référence montrée par
 * l'utilisateur. `identityOf` (pas le premier mot brut) garantit que des
 * sous-commandes différentes ("role create" / "role delete") restent deux
 * entrées séparées au lieu de se confondre sous "role".
 */
function namesWithAliases(commands) {
  const byIdentity = new Map();
  for (const cmd of commands) {
    const id = identityOf(cmd);
    if (!byIdentity.has(id)) byIdentity.set(id, new Set());
    for (const a of cmd.aliases || []) byIdentity.get(id).add(a);
  }
  return [...byIdentity].map(([id, aliases]) => (aliases.size ? `${id}/${[...aliases].join("/")}` : id));
}

/**
 * Groupe par palier d'accès, toutes les commandes d'une catégorie tenant
 * sur un seul écran (liste compacte de noms, pas le détail syntaxe +
 * description qui alourdissait inutilement l'affichage). Les commandes
 * seulement DOCUMENTÉES sont mises à part : les afficher au milieu des
 * autres promettrait qu'elles répondent (voir utils/implementedCommands.js).
 */
function tieredBody(commands) {
  const groups = { public: [], configurable: [], sys: [] };
  const documented = [];
  for (const cmd of commands) {
    if (isImplemented(cmd)) groups[tierOf(cmd)].push(cmd);
    else documented.push(cmd);
  }

  // Une identité ne peut apparaître qu'une fois au total.
  const placed = new Set();
  const sections = [];
  for (const tier of ["public", "configurable", "sys"]) {
    const names = namesWithAliases(groups[tier]).filter((n) => !placed.has(n));
    if (!names.length) continue;
    for (const n of names) placed.add(n);
    sections.push(`**${TIER_LABELS[tier]} (${names.length}) :** ${names.join(", ")}`);
  }

  const documentedNames = namesWithAliases(documented).filter((n) => !placed.has(n));
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
      new StringSelectMenuOptionBuilder().setLabel("Accueil").setDescription("Vue d'ensemble").setValue(HOME).setDefault(current === HOME),
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
 * liste séparée qui pourrait diverger. Components V2 sans setAccentColor.
 * @param {string} guildId
 * @param {import('discord.js').GuildMember} member
 * @param {string} [current] clé de catégorie, ou HOME
 */
function buildHelpPanel(guildId, member, current = HOME) {
  const prefixes = getPrefixes(guildId);
  const categories = categoriesFor((permission) => can(member, permission));
  const category = categories.find((c) => c.key === current);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(category ? `## Aide — ${category.label}` : "## Aide"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(category ? categoryBody(category) : homeBody(categories, prefixes)));

  if (categories.length) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(buildSelect(categories, category ? current : HOME)));
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** Toutes les interactions "help_*" (voir index.js) : navigation catégorie uniquement. */
async function handleHelpInteraction(interaction) {
  const panel = buildHelpPanel(interaction.guild.id, interaction.member, interaction.values[0]);

  // Premier clic sur le message PUBLIC (&help) : nouvelle réponse éphémère,
  // impossible d'éditer le message public sans montrer à tout le salon le
  // contenu filtré d'une seule personne. Clics suivants (déjà sur SA carte
  // éphémère) : on édite en place plutôt que d'empiler une carte par choix.
  if (interaction.message.flags?.has(MessageFlags.Ephemeral)) {
    return interaction.update(panel).catch(() => {});
  }
  return interaction.reply({ ...panel, flags: panel.flags | MessageFlags.Ephemeral }).catch(() => {});
}

module.exports = { buildHelpPanel, handleHelpInteraction, identityOf, SELECT_ID };
