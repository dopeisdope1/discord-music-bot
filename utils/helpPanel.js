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

function tierOf(cmd) {
  if (cmd.permission === "sys") return "sys";
  if (cmd.permission == null) return "public";
  return "configurable";
}

const TIER_ORDER = ["public", "configurable", "sys"];
const TIER_LABELS = { public: "Commandes publiques", configurable: "Commandes configurables", sys: "Commandes Sys" };

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
 * Répartit des blocs de texte sur plusieurs TextDisplay (chacun plafonné à
 * 4000 caractères côté Discord) : un palier dense ("Commandes
 * configurables", 100+ commandes une fois détaillées) dépasse largement
 * cette limite en un seul bloc — la coupe se fait toujours ENTRE deux
 * commandes, jamais au milieu de l'une d'elles.
 */
function chunkBlocks(blocks, maxLen = 3800) {
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
 * accès, groupées par PALIER uniquement — toutes catégories du catalogue
 * confondues (demande explicite : pas de découpage par thème). Les
 * commandes seulement documentées (sans backend) ne sont jamais incluses.
 * @returns {Record<"public"|"configurable"|"sys", object[]>}
 */
function groupByTier(member) {
  const canUse = (permission) => can(member, permission);
  const groups = { public: [], configurable: [], sys: [] };
  for (const category of CATEGORIES) {
    for (const cmd of category.commands) {
      if (!isImplemented(cmd)) continue;
      // &panel n'est gardée par AUCUNE clé unique du catalogue — la vraie
      // commande vérifie hasAnyPanelAccess (n'importe quelle permission de
      // rubrique du panel). Sans ce cas particulier, &help l'annonçait
      // "publique" même à un membre sans aucun droit, pour qui la commande
      // ne fait pourtant rien.
      if (identityOf(cmd) === "panel") {
        if (hasAnyPanelAccessLazy(member)) groups.configurable.push(cmd);
        continue;
      }
      if (!canUse(cmd.permission)) continue;
      groups[tierOf(cmd)].push(cmd);
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
 */
function buildHelpPanel(guildId, member, tier = null, authorId) {
  const prefixes = getPrefixes(guildId);
  const groups = groupByTier(member);
  const availableTiers = TIER_ORDER.filter((t) => groups[t].length);
  const activeTier = availableTiers.includes(tier) ? tier : null;

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(activeTier ? `## Aide — ${TIER_LABELS[activeTier]}` : "## Aide")
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  if (activeTier) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("Les arguments entre `[]` sont **facultatifs**, les arguments entre `<>` sont **obligatoires**")
    );
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    const entries = dedupeByIdentity(groups[activeTier]);
    const blocks = entries.map((e) => formatCommandBlock(e, prefixes.musicMod));
    for (const chunk of chunkBlocks(blocks)) {
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
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Toutes les interactions "help_tier:<authorId>" (voir index.js) : choix
 * d'un palier. Message PUBLIC et unique, édité en place à chaque clic —
 * jamais de nouveau message — mais réservé à qui a lancé &help : n'importe
 * qui d'autre verrait un palier filtré sur SES droits à lui, potentiellement
 * plus larges (Sys, configurable), affiché publiquement dans le salon.
 */
async function handleHelpInteraction(interaction) {
  const [, authorId] = interaction.customId.split(":");
  if (interaction.user.id !== authorId) {
    return interaction
      .reply({ content: "Seule la personne qui a lancé `&help` peut utiliser ce menu.", flags: MessageFlags.Ephemeral })
      .catch(() => {});
  }
  const panel = buildHelpPanel(interaction.guild.id, interaction.member, interaction.values[0], authorId);
  return interaction.update(panel).catch(() => {});
}

module.exports = { buildHelpPanel, handleHelpInteraction, identityOf, SELECT_ID };
