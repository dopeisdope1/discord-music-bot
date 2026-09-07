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
const { CATEGORIES } = require("./commandCatalog");
const { isImplemented } = require("./implementedCommands");

const SELECT_ID = "help_tier";
const PAGE_SELECT_ID = "help_page";

// Confirmé en prod via le vrai message d'erreur Discord (avant, avalé
// silencieusement par un .catch vide — la vraie cause n'était pas celle
// devinée au premier passage) :
//   DiscordAPIError[50035] data.components[COMPONENT_DISPLAYABLE_TEXT_SIZE_EXCEEDED]:
//   Components displayable text size exceeds maximum size of 4000
// Ce n'est PAS une limite par composant (chaque TextDisplay peut déjà aller
// jusqu'à 4000) mais le TOTAL du texte affichable de TOUS les composants du
// message CUMULÉS. D'où : un seul bloc de commandes par page (pas deux), et
// chunkBlocks vise plus bas que 4000 pour laisser de la place au titre/à la
// légende qui partagent le même budget.
const MAX_CHUNKS_PER_PAGE = 1;

/**
 * Identité d'affichage d'une commande : tous les mots de TÊTE qui sont de
 * vrais mots du déclencheur (pas un argument) — même logique que
 * utils/implementedCommands.js::isImplemented. Sans ça, "role create",
 * "role delete", "role rename"... fusionnaient tous sous le seul mot
 * ambigu "role".
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

// Regroupement par THÈME (Modération/Sécurité/Rôles & Membres/...) — demande
// explicite de l'utilisateur, à la place de l'ancien tri par palier de
// permission (public/configurable/sys), qui mélangeait des commandes sans
// rapport dans le même palier "configurable". Les thèmes eux-mêmes sont
// définis une seule fois dans utils/commandCatalog.js, jamais recopiés ici.
const TIER_ORDER = CATEGORIES.map((c) => c.key);
const TIER_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));

/**
 * Réduit une liste d'entrées du catalogue à des IDENTITÉS distinctes, en
 * gardant la commande représentative (syntaxe + description) et les alias
 * de chacune. `identityOf` (pas le premier mot brut) garantit que des
 * sous-commandes différentes ("role create" / "role delete") restent deux
 * entrées séparées au lieu de se confondre sous "role".
 * @returns {{ cmd: object, aliases: string[] }[]}
 */
function dedupeByIdentity(commands) {
  const byIdentity = new Map();
  for (const cmd of commands) {
    const id = identityOf(cmd);
    if (!byIdentity.has(id)) byIdentity.set(id, { cmd, aliases: new Set() });
    for (const a of cmd.aliases || []) byIdentity.get(id).aliases.add(a);
  }
  return [...byIdentity.values()].map(({ cmd, aliases }) => ({ cmd, aliases: [...aliases] }));
}

/** Une commande, en bloc : nom (+alias) en gras, description, puis la syntaxe réelle à taper. */
function formatCommandBlock(entry, prefixSymbol) {
  const heading = entry.aliases.length ? `${identityOf(entry.cmd)}/${entry.aliases.join("/")}` : identityOf(entry.cmd);
  return `**${heading}** (${entry.cmd.description})\n└ Usage : \`${prefixSymbol}${entry.cmd.name}\``;
}

/**
 * Répartit des blocs de texte en chunks — un par PAGE (voir
 * MAX_CHUNKS_PER_PAGE), jamais plusieurs dans le même message, puisque la
 * limite de 4000 caractères de Discord porte sur le TOTAL affichable du
 * message, titre+légende compris, pas sur chaque composant pris à part.
 * maxLen reste sous 4000 avec de la marge pour ce titre+légende. La coupe se
 * fait toujours ENTRE deux commandes, jamais au milieu de l'une d'elles.
 */
function chunkBlocks(blocks, maxLen = 3600) {
  const chunks = [];
  let current = [];
  let currentLen = 0;
  for (const block of blocks) {
    const addedLen = block.length + 2; // +2 pour le "\n\n" de séparation
    if (current.length && currentLen + addedLen > maxLen) {
      chunks.push(current.join("\n\n"));
      current = [];
      currentLen = 0;
    }
    current.push(block);
    currentLen += addedLen;
  }
  if (current.length) chunks.push(current.join("\n\n"));
  return chunks;
}

// Différé, pas en tête de fichier : utils/configPanel.js require
// utils/permsCommands.js qui require ici — un require en tête fermerait la
// boucle et renverrait un module vide (même piège que celui documenté dans
// utils/implementedCommands.js pour musicCommands.js).
let hasAnyPanelAccessCache = null;
function hasAnyPanelAccessLazy(member) {
  if (!hasAnyPanelAccessCache) hasAnyPanelAccessCache = require("./configPanel").hasAnyPanelAccess;
  return hasAnyPanelAccessCache(member);
}

/**
 * Toutes les commandes IMPLÉMENTÉES du catalogue auxquelles `member` a
 * accès, groupées par THÈME (utils/commandCatalog.js::CATEGORIES). Les
 * commandes seulement documentées (sans backend) ne sont jamais incluses.
 * @returns {Record<string, object[]>} une entrée par clé de CATEGORIES
 */
function groupByTier(member) {
  const canUse = (permission) => can(member, permission);
  const groups = Object.fromEntries(TIER_ORDER.map((key) => [key, []]));
  for (const category of CATEGORIES) {
    for (const cmd of category.commands) {
      if (!isImplemented(cmd)) continue;
      // &panel n'est gardée par AUCUNE clé unique du catalogue — la vraie
      // commande vérifie hasAnyPanelAccess (n'importe quelle permission de
      // rubrique du panel). Sans ce cas particulier, &help l'annonçait
      // "accessible" même à un membre sans aucun droit, pour qui la commande
      // ne fait pourtant rien. Elle vit dans la catégorie "Bot & Accès" du
      // catalogue, comme n'importe quelle autre commande de ce thème.
      if (identityOf(cmd) === "panel") {
        if (hasAnyPanelAccessLazy(member)) groups[category.key].push(cmd);
        continue;
      }
      if (!canUse(cmd.permission)) continue;
      groups[category.key].push(cmd);
    }
  }
  return groups;
}

function buildSelect(availableTiers, current, authorId) {
  // "Accueil" toujours présent dans le même menu : une fois entré dans un
  // palier, il donne le chemin retour sans avoir à retaper &help.
  // L'ID de l'auteur est encodé dans le customId : le message est public
  // (pas d'ephémère possible pour une commande texte), mais seul l'auteur
  // doit pouvoir le piloter (voir handleHelpInteraction).
  const options = [
    new StringSelectMenuOptionBuilder().setLabel("Accueil").setValue("home").setDefault(current === null),
    ...availableTiers.map((tier) =>
      new StringSelectMenuOptionBuilder().setLabel(TIER_LABELS[tier]).setValue(tier).setDefault(tier === current)
    ),
  ];
  return new StringSelectMenuBuilder()
    .setCustomId(`${SELECT_ID}:${authorId}`)
    .setPlaceholder("Choisir un palier")
    .addOptions(options);
}

/** Pagination du palier actif, même style que utils/listCard.js::buildListCard. */
function buildPageSelect(tier, page, totalPages, authorId) {
  const options = [];
  if (page > 0) options.push(new StringSelectMenuOptionBuilder().setLabel("Page précédente").setValue(String(page - 1)));
  if (page < totalPages - 1) options.push(new StringSelectMenuOptionBuilder().setLabel("Page suivante").setValue(String(page + 1)));
  return new StringSelectMenuBuilder()
    .setCustomId(`${PAGE_SELECT_ID}:${authorId}:${tier}`)
    .setPlaceholder(`Page ${page + 1}/${totalPages}`)
    .addOptions(options);
}

/**
 * &help — vue d'ensemble compacte (juste les paliers et leur effectif) puis,
 * une fois un palier choisi dans le menu, la liste de ses commandes. Filtré
 * sur les droits RÉELS de la personne — même moteur que les commandes et le
 * panel (utils/permissions/engine.js), pas une liste séparée qui pourrait
 * diverger.
 * @param {string} guildId
 * @param {import('discord.js').GuildMember} member
 * @param {string|null} [tier] palier actif ("public"/"configurable"/"sys")
 * @param {string} authorId qui a lancé &help — seul lui peut piloter le menu
 * @param {number} [page] page de commandes affichée dans le palier actif
 */
function buildHelpPanel(guildId, member, tier = null, authorId, page = 0) {
  const prefixes = getPrefixes(guildId);
  const groups = groupByTier(member);
  const availableTiers = TIER_ORDER.filter((t) => groups[t].length);
  const activeTier = availableTiers.includes(tier) ? tier : null;

  const container = new ContainerBuilder();
  // Titre ET légende dans le MÊME bloc de texte (pas deux composants
  // séparés) : chaque composant compte dans la limite du Container, et le
  // palier dense en a besoin ailleurs (voir MAX_CHUNKS_PER_PAGE ci-dessus).
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      activeTier
        ? `## Aide — ${TIER_LABELS[activeTier]}\nLes arguments entre \`[]\` sont **facultatifs**, les arguments entre \`<>\` sont **obligatoires**`
        : "## Aide"
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  let clampedPage = 0;
  let totalPages = 1;
  if (activeTier) {
    const entries = dedupeByIdentity(groups[activeTier]);
    const blocks = entries.map((e) => formatCommandBlock(e, prefixes.musicMod));
    const chunks = chunkBlocks(blocks);
    totalPages = Math.max(1, Math.ceil(chunks.length / MAX_CHUNKS_PER_PAGE));
    clampedPage = Math.min(Math.max(0, page), totalPages - 1);
    const pageChunks = chunks.slice(clampedPage * MAX_CHUNKS_PER_PAGE, (clampedPage + 1) * MAX_CHUNKS_PER_PAGE);
    for (const chunk of pageChunks) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(chunk));
    }
  } else {
    const lines = availableTiers.map((t) => `> **${TIER_LABELS[t]}** — ${groups[t].length} commande(s)`);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        [
          "Voici les commandes que tu peux utiliser sur ce serveur.",
          "Les arguments entre `[]` sont **facultatifs**, les arguments entre `<>` sont **obligatoires**",
          "",
          ...(lines.length ? lines : ["*Aucune commande accessible.*"]),
          "",
          `Préfixe musique : \`${prefixes.main}\` · préfixe commandes : \`${prefixes.musicMod}\``,
        ].join("\n")
      )
    );
  }

  if (availableTiers.length) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(buildSelect(availableTiers, activeTier, authorId)));
    if (activeTier && totalPages > 1) {
      container.addActionRowComponents(new ActionRowBuilder().addComponents(buildPageSelect(activeTier, clampedPage, totalPages, authorId)));
    }
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Toutes les interactions "help_tier:<authorId>" (choix d'un palier, revient
 * à la page 0) ET "help_page:<authorId>:<tier>" (change de page dans le
 * palier actif) — voir index.js. Message PUBLIC et unique, édité en place à
 * chaque clic — jamais de nouveau message — mais réservé à qui a lancé
 * &help : n'importe qui d'autre verrait un palier filtré sur SES droits à
 * lui, potentiellement plus larges (Sys, configurable), affiché publiquement
 * dans le salon.
 */
async function handleHelpInteraction(interaction) {
  const [kind, authorId, tierFromCustomId] = interaction.customId.split(":");
  if (interaction.user.id !== authorId) {
    return interaction
      .reply({ content: "Seule la personne qui a lancé `&help` peut utiliser ce menu.", flags: MessageFlags.Ephemeral })
      .catch(() => {});
  }
  const tier = kind === PAGE_SELECT_ID ? tierFromCustomId : interaction.values[0];
  const page = kind === PAGE_SELECT_ID ? parseInt(interaction.values[0], 10) || 0 : 0;
  const panel = buildHelpPanel(interaction.guild.id, interaction.member, tier, authorId, page);
  return interaction.update(panel).catch((err) => console.error("[helpPanel] interaction.update a échoué :", err));
}

module.exports = { buildHelpPanel, handleHelpInteraction, identityOf, SELECT_ID, PAGE_SELECT_ID };
