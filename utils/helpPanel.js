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

const CATEGORY_SELECT_ID = "help_nav";
const TIER_SELECT_ID = "help_tier";
const PAGE_SELECT_ID = "help_page";
const HOME = "__home__";
const PAGE_SIZE = 8;

/**
 * Identité d'affichage d'une commande : tous les mots de TÊTE qui sont de
 * vrais mots du déclencheur (pas un argument) — même logique que
 * utils/implementedCommands.js::isImplemented, pour rester cohérent avec ce
 * qui est réellement routé. Sans ça, "role create", "role delete", "role
 * rename", "role color" et "role admin" fusionnaient tous sous le seul mot
 * ambigu "role" : cinq commandes différentes affichées comme une seule.
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

function tierOf(cmd) {
  if (cmd.permission === "sys") return "sys";
  if (cmd.permission == null) return "public";
  return "configurable";
}

// "documented" est un palier À PART : ce sont des entrées du catalogue sans
// backend (demande explicite : "intègre tout, même sans backend"). Les
// afficher au milieu des autres promettrait qu'elles répondent — un palier
// séparé, sélectionnable comme les autres, dit clairement ce qui marche.
const TIER_ORDER = ["public", "configurable", "sys", "documented"];
const TIER_LABELS = {
  public: "Commandes publiques",
  configurable: "Commandes configurables",
  sys: "Commandes Sys",
  documented: "Documentées, pas encore actives",
};

/**
 * Regroupe les commandes d'une catégorie (déjà filtrées sur les droits
 * réels de la personne) par palier, chaque IDENTITÉ n'apparaissant qu'une
 * fois au total — garde-fou contre un doublon accidentel dans le catalogue,
 * plus un mécanisme de fusion : chaque sous-commande garde sa propre ligne.
 * @returns {Record<string, object[]>}
 */
function groupByTier(commands) {
  const groups = { public: [], configurable: [], sys: [], documented: [] };
  const placed = new Set();
  for (const cmd of commands) {
    const id = identityOf(cmd);
    if (placed.has(id)) continue;
    placed.add(id);
    groups[isImplemented(cmd) ? tierOf(cmd) : "documented"].push(cmd);
  }
  return groups;
}

/** Paliers non vides, dans l'ordre d'affichage — sert au menu ET au choix par défaut. */
function nonEmptyTiers(groups) {
  return TIER_ORDER.filter((t) => groups[t].length);
}

function paginate(items, page) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const clamped = Math.min(Math.max(0, page), totalPages - 1);
  return { slice: items.slice(clamped * PAGE_SIZE, clamped * PAGE_SIZE + PAGE_SIZE), page: clamped, totalPages };
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
    "Choisis une **catégorie**, puis un **palier** — les commandes s'affichent par petits lots, faciles à parcourir.",
    "Cette liste dépend de TES droits réels — le même système que le panel de configuration " +
      "(voir `&panel` > Permissions) : ce que tu vois ici, tu peux réellement l'utiliser.",
    "Les arguments entre `[]` sont **facultatifs**, les arguments entre `<>` sont **obligatoires**",
    "",
    ...lines,
    "",
    `Préfixe musique : \`${prefixes.main}\` · préfixe commandes : \`${prefixes.musicMod}\``,
  ].join("\n");
}

function buildCategorySelect(categories, current) {
  return new StringSelectMenuBuilder()
    .setCustomId(CATEGORY_SELECT_ID)
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

function buildTierSelect(categoryKey, groups, activeTier) {
  return new StringSelectMenuBuilder()
    .setCustomId(`${TIER_SELECT_ID}:${categoryKey}`)
    .setPlaceholder("Choisir un palier")
    .addOptions(
      nonEmptyTiers(groups).map((t) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(TIER_LABELS[t])
          .setDescription(`${groups[t].length} commande(s)`)
          .setValue(t)
          .setDefault(t === activeTier)
      )
    );
}

function buildPageSelect(categoryKey, tier, page, totalPages) {
  const options = [];
  if (page > 0) options.push(new StringSelectMenuOptionBuilder().setLabel("◀ Page précédente").setValue(String(page - 1)));
  if (page < totalPages - 1) options.push(new StringSelectMenuOptionBuilder().setLabel("Page suivante ▶").setValue(String(page + 1)));
  return new StringSelectMenuBuilder()
    .setCustomId(`${PAGE_SELECT_ID}:${categoryKey}:${tier}`)
    .setPlaceholder(`Page ${page + 1}/${totalPages}`)
    .addOptions(options);
}

/**
 * Panneau d'aide filtré sur les droits RÉELS de la personne — même moteur
 * que les commandes et le panel (utils/permissions/engine.js), pas une
 * liste séparée qui pourrait diverger. Components V2 sans setAccentColor.
 *
 * Navigation en trois niveaux (Accueil -> Catégorie -> Palier, paginé) : une
 * catégorie de 30 commandes ne les affiche plus toutes empilées sur un seul
 * écran — signalé comme encore trop dense malgré la syntaxe/description par
 * ligne. Le palier se choisit automatiquement s'il n'y en a qu'un.
 *
 * @param {string} guildId
 * @param {import('discord.js').GuildMember} member
 * @param {string} [current] clé de catégorie, ou HOME
 * @param {string|null} [tier] palier actif dans la catégorie
 * @param {number} [page] page 0-indexée dans le palier actif
 */
function buildHelpPanel(guildId, member, current = HOME, tier = null, page = 0) {
  const prefixes = getPrefixes(guildId);
  const categories = categoriesFor((permission) => can(member, permission));
  const category = categories.find((c) => c.key === current);

  const container = new ContainerBuilder();

  if (!category) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Aide"));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(homeBody(categories, prefixes)));
    if (categories.length) {
      container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
      container.addActionRowComponents(new ActionRowBuilder().addComponents(buildCategorySelect(categories, HOME)));
    }
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

  const groups = groupByTier(category.commands);
  const available = nonEmptyTiers(groups);
  const activeTier = available.includes(tier) ? tier : available[0] || null;

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Aide — ${category.label}${activeTier ? ` · ${TIER_LABELS[activeTier]}` : ""}`)
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  if (!activeTier) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("*Aucune commande accessible dans cette catégorie.*"));
  } else {
    const { slice, page: clampedPage, totalPages } = paginate(groups[activeTier], page);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(slice.map(formatEntry).join("\n")));
    if (totalPages > 1) {
      container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
      container.addActionRowComponents(new ActionRowBuilder().addComponents(buildPageSelect(current, activeTier, clampedPage, totalPages)));
    }
  }

  if (available.length > 1) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(buildTierSelect(current, groups, activeTier)));
  }

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(buildCategorySelect(categories, current)));

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Toutes les interactions "help_*" (voir index.js) : navigation catégorie,
 * choix de palier, changement de page — un seul point d'entrée, comme le
 * reste du bot (utils/configPanel.js::handleConfigInteraction).
 */
async function handleHelpInteraction(interaction) {
  const [kind, categoryKey, tierArg] = interaction.customId.split(":");
  const guildId = interaction.guild.id;
  const member = interaction.member;

  let panel;
  if (kind === CATEGORY_SELECT_ID) {
    panel = buildHelpPanel(guildId, member, interaction.values[0]);
  } else if (kind === TIER_SELECT_ID) {
    panel = buildHelpPanel(guildId, member, categoryKey, interaction.values[0]);
  } else if (kind === PAGE_SELECT_ID) {
    panel = buildHelpPanel(guildId, member, categoryKey, tierArg, parseInt(interaction.values[0], 10) || 0);
  } else {
    return;
  }

  // Premier clic sur le message PUBLIC (&help) : nouvelle réponse éphémère,
  // impossible d'éditer le message public sans montrer à tout le salon le
  // contenu filtré d'une seule personne. Clics suivants (déjà sur SA carte
  // éphémère) : on édite en place plutôt que d'empiler une carte par choix.
  if (interaction.message.flags?.has(MessageFlags.Ephemeral)) {
    return interaction.update(panel).catch(() => {});
  }
  return interaction.reply({ ...panel, flags: panel.flags | MessageFlags.Ephemeral }).catch(() => {});
}

module.exports = { buildHelpPanel, handleHelpInteraction, groupByTier, identityOf, CATEGORY_SELECT_ID, TIER_SELECT_ID, PAGE_SELECT_ID };
