const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} = require("discord.js");
const { getPrefixes } = require("./prefixStore");
const { can } = require("./permissions/engine");
const { CATEGORIES } = require("./commandCatalog");
const { isImplemented } = require("./implementedCommands");

// Couleur d'accent PARTAGÉE avec &panel (utils/configPanel.js) — même
// identité visuelle pour les deux "pages" du même système, demande
// explicite ("Centre de commandes" / "Centre de gestion").
const ACCENT_COLOR = 0x2c2f5c;

const SELECT_ID = "help_tier";
const PAGE_SELECT_ID = "help_page";

// Confirmé en prod via le vrai message d'erreur Discord (avant, avalé
// silencieusement par un .catch vide — la vraie cause n'était pas celle
// devinée au premier passage) :
//   DiscordAPIError[50035] data.components[COMPONENT_DISPLAYABLE_TEXT_SIZE_EXCEEDED]:
//   Components displayable text size exceeds maximum size of 4000
// Ce n'est PAS une limite par composant (chaque TextDisplay peut déjà aller
// jusqu'à 4000) mais le TOTAL du texte affichable de TOUS les composants du
// message CUMULÉ. D'où : un seul bloc de commandes par page (pas deux), et
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
const TIER_EMOJI = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.emoji]));
const TIER_DESCRIPTIONS = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.description]));

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

/**
 * Une commande, en bloc : nom (+alias) en gras, description, puis la syntaxe
 * réelle à taper. Un 🔒 discret signale une commande qui exige un droit
 * particulier — pas la clé technique exacte, juste le signal qu'elle est
 * restreinte (l'accès réel reste filtré en amont, ce n'est qu'un repère
 * visuel pour les commandes déjà accordées à cette personne).
 */
function formatCommandBlock(entry, prefixSymbol) {
  const heading = entry.aliases.length ? `${identityOf(entry.cmd)}/${entry.aliases.join("/")}` : identityOf(entry.cmd);
  const lock = entry.cmd.permission ? " 🔒" : "";
  return `🔹 **${heading}**${lock} — ${entry.cmd.description}\n└ \`${prefixSymbol}${entry.cmd.name}\``;
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

/**
 * Boutons de navigation entre catégories + "Accueil" — remplace l'ancien
 * menu déroulant (demande explicite : look "dashboard" avec des boutons
 * comme le screenshot de référence). La catégorie/l'accueil actif ressort en
 * style Primary (rempli), les autres en Secondary (gris) — Discord n'a pas
 * d'état "sélectionné" natif sur un bouton, ce contraste en tient lieu.
 * Répartis sur plusieurs rangées (5 boutons max par ActionRow, limite
 * Discord).
 */
function buildCategoryButtons(availableTiers, current, authorId) {
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`${SELECT_ID}:${authorId}:home`)
      .setLabel("Accueil")
      .setEmoji("🏠")
      .setStyle(current === null ? ButtonStyle.Primary : ButtonStyle.Secondary),
    ...availableTiers.map((tier) =>
      new ButtonBuilder()
        .setCustomId(`${SELECT_ID}:${authorId}:${tier}`)
        .setLabel(TIER_LABELS[tier])
        .setEmoji(TIER_EMOJI[tier])
        .setStyle(tier === current ? ButtonStyle.Primary : ButtonStyle.Secondary)
    ),
  ];
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  return rows;
}

/** Pagination de la catégorie active, même style que utils/listCard.js::buildListCard. */
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
 * &help — "Centre de commandes" : à l'accueil, chaque catégorie thématique
 * en bloc (emoji + description courte, JAMAIS de compteur de commandes) ;
 * une catégorie choisie détaille ses commandes. Filtré sur les droits RÉELS
 * de la personne — même moteur que les commandes et le panel
 * (utils/permissions/engine.js), pas une liste séparée qui pourrait diverger.
 * @param {string} guildId
 * @param {import('discord.js').GuildMember} member
 * @param {string|null} [tier] catégorie active (une clé de CATEGORIES, ou null pour l'accueil)
 * @param {string} authorId qui a lancé &help — seul lui peut piloter la navigation
 * @param {number} [page] page de commandes affichée dans la catégorie active
 */
function buildHelpPanel(guildId, member, tier = null, authorId, page = 0) {
  const prefixes = getPrefixes(guildId);
  const groups = groupByTier(member);
  const availableTiers = TIER_ORDER.filter((t) => groups[t].length);
  const activeTier = availableTiers.includes(tier) ? tier : null;

  const container = new ContainerBuilder().setAccentColor(ACCENT_COLOR);

  // En-tête partagé avec &panel ("Centre de commandes" / "Centre de
  // gestion") : titre + uniquement le pseudo (pas de niveau/rang, ce bot n'a
  // pas ce système) — <@id> reste valide même si le membre n'a jamais été
  // mis en cache, pas besoin de résoudre un pseudo affichable.
  const headerLines = [
    "## 🖥️ 「 CENTRE DE COMMANDES 」",
    `> <@${authorId}> · Préfixe : \`${prefixes.musicMod}\``,
  ];
  if (activeTier) {
    headerLines.push(`### ${TIER_EMOJI[activeTier]} ${TIER_LABELS[activeTier]}`);
    headerLines.push("Les arguments entre `[]` sont **facultatifs**, les arguments entre `<>` sont **obligatoires**");
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerLines.join("\n")));
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
    // Chaque catégorie tient sur DEUX lignes seulement (titre+description
    // sur une ligne, aperçu de 4 commandes réelles sur l'autre) — pas de
    // séparateur ni de bloc dédié par catégorie, qui gonflait inutilement
    // l'accueil en hauteur. Un ContainerBuilder Components V2 reste de
    // toute façon plafonné à un petit nombre de composants (voir
    // utils/commandForms.js::CONTAINER_BUDGET) : tout tient donc dans UN
    // SEUL bloc de texte, dense, façon tableau de bord compact.
    const cards = availableTiers.map((t) => {
      const preview = dedupeByIdentity(groups[t])
        .slice(0, 4)
        .map((e) => identityOf(e.cmd))
        .join(" • ");
      const ligneCommandes = preview ? `\n${preview}` : "";
      return `${TIER_EMOJI[t]} **${TIER_LABELS[t]}** — ${TIER_DESCRIPTIONS[t]}${ligneCommandes}`;
    });
    const body = cards.length ? cards.join("\n\n") : "*Aucune commande accessible.*";
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${body}\n\n*Tape une commande pour commencer*`));
  }

  if (availableTiers.length) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    for (const row of buildCategoryButtons(availableTiers, activeTier, authorId)) {
      container.addActionRowComponents(row);
    }
    if (activeTier && totalPages > 1) {
      container.addActionRowComponents(new ActionRowBuilder().addComponents(buildPageSelect(activeTier, clampedPage, totalPages, authorId)));
    }
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Toutes les interactions "help_tier:<authorId>:<catégorie|home>" (bouton de
 * navigation, revient à la page 0) ET "help_page:<authorId>:<catégorie>"
 * (menu de pagination dans la catégorie active) — voir index.js. Message
 * PUBLIC et unique, édité en place à chaque clic — jamais de nouveau message
 * — mais réservé à qui a lancé &help : n'importe qui d'autre verrait une
 * catégorie filtrée sur SES droits à lui, potentiellement plus larges,
 * affichée publiquement dans le salon.
 */
async function handleHelpInteraction(interaction) {
  const [kind, authorId, tier] = interaction.customId.split(":");
  if (interaction.user.id !== authorId) {
    return interaction
      .reply({ content: "Seule la personne qui a lancé `&help` peut utiliser ce menu.", flags: MessageFlags.Ephemeral })
      .catch(() => {});
  }
  const page = kind === PAGE_SELECT_ID ? parseInt(interaction.values[0], 10) || 0 : 0;
  const panel = buildHelpPanel(interaction.guild.id, interaction.member, tier, authorId, page);
  return interaction.update(panel).catch((err) => console.error("[helpPanel] interaction.update a échoué :", err));
}

module.exports = { buildHelpPanel, handleHelpInteraction, identityOf, SELECT_ID, PAGE_SELECT_ID, ACCENT_COLOR };
