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
 * Réduit une liste d'entrées du catalogue à des IDENTITÉS distinctes, alias
 * collés ("pic/avatar"). `identityOf` (pas le premier mot brut) garantit
 * que des sous-commandes différentes ("role create" / "role delete")
 * restent deux entrées séparées au lieu de se confondre sous "role".
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
      if (!isImplemented(cmd) || !canUse(cmd.permission)) continue;
      groups[tierOf(cmd)].push(cmd);
    }
  }
  return groups;
}

function buildSelect(availableTiers, current) {
  return new StringSelectMenuBuilder()
    .setCustomId(SELECT_ID)
    .setPlaceholder("Choisir un palier")
    .addOptions(
      availableTiers.map((tier) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(TIER_LABELS[tier])
          .setValue(tier)
          .setDefault(tier === current)
      )
    );
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
 */
function buildHelpPanel(guildId, member, tier = null) {
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
    const names = namesWithAliases(groups[activeTier]);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(names.join(", ")));
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
    container.addActionRowComponents(new ActionRowBuilder().addComponents(buildSelect(availableTiers, activeTier)));
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** Toutes les interactions "help_tier" (voir index.js) : choix d'un palier. */
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
