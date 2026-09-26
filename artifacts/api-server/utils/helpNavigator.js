const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");
const { getPrefixes } = require("./prefixStore");
const { dedupeByIdentity, formatLine, PALIERS, identityOf, estDangereux } = require("./helpPanel");
const { can, hasConfiguredAccess } = require("./permissions/engine");
const { CATEGORIES } = require("./commandCatalog");
const { isImplemented } = require("./implementedCommands");
const { emojiDe } = require("./emojiSlots");
const messageOwner = require("./messageOwner");

// Remplace le "help" en texte pur/carte figée (&help) par un moteur navigable
// : un seul message, un menu déroulant ("Choisir un palier") + Précédent/
// Suivant quand un groupe ne tient pas sur une page — jamais de nouveau
// message posté après le premier.
const CUSTOM_ID = "helpnav";

// Seul préfixe restant depuis le départ de la modération vers son propre
// bot (voir utils/prefixStore.js) — plus de bucket à distinguer.
const TITRE = "Aide";
const PREFIX_KEY = "musicMod";

// Budget du texte d'UN palier affiché, en caractères — le reste du message
// (titre, compteurs d'accueil, pied de page) tient large dans la marge par
// rapport au plafond réel de Discord (4000 caractères, tous composants
// texte additionnés).
const LIMITE_PAGE = 3400;

function paginerLignes(lignes) {
  const pages = [];
  let courante = [];
  let longueur = 0;
  for (const ligne of lignes) {
    const ajout = ligne.length + 1;
    if (courante.length && longueur + ajout > LIMITE_PAGE) {
      pages.push(courante);
      courante = [];
      longueur = 0;
    }
    courante.push(ligne);
    longueur += ajout;
  }
  if (courante.length) pages.push(courante);
  return pages.length ? pages : [[]];
}

/**
 * Assemble les lignes d'un palier à partir de groupes thématiques (catégorie
 * du catalogue, ou "groupe" des listes figées "!!"/"="), CHACUN précédé de
 * son propre en-tête emoji+libellé — demande explicite, calquée sur la
 * présentation d'un autre bot ("Modération"/"Permissions"/"Listes"/...).
 * `lignesParGroupe` : Map<libellé, { emoji, lignes: string[] }>, dans l'ordre
 * d'insertion (celui du catalogue).
 * @returns {{ lines: string[], count: number }} `lines` inclut les en-têtes
 *   (pour l'affichage/pagination), `count` ne compte QUE les commandes.
 */
function assemblerGroupes(lignesParGroupe) {
  const lines = [];
  let count = 0;
  for (const [label, { emoji, lignes }] of lignesParGroupe) {
    if (!lignes.length) continue;
    lines.push(`### ${emoji ? `${emoji} ` : ""}${label}`);
    lines.push(...lignes);
    count += lignes.length;
  }
  return { lines, count };
}

/** Paliers de droit (public/configurable/sys) non vides, groupés par catégorie du catalogue central — pour "&help". */
function buildTiersCatalogue(guildId, member) {
  const prefixes = getPrefixes(guildId);
  const modeDecouverte = !hasConfiguredAccess(member);
  // palier -> Map<libellé de catégorie, { emoji, cmds: [] }>
  const parPalier = { public: new Map(), configurable: new Map(), sys: new Map() };

  for (const categorie of CATEGORIES) {
    for (const cmd of categorie.commands) {
      if (!isImplemented(cmd)) continue;
      if (modeDecouverte && identityOf(cmd) !== "help") continue;
      if (!can(member, cmd.permission)) continue;

      const palier = !cmd.permission ? "public" : estDangereux(cmd.permission) ? "sys" : "configurable";
      const map = parPalier[palier];
      if (!map.has(categorie.label)) map.set(categorie.label, { emoji: emojiDe(guildId, `cat:${categorie.key}`), cmds: [] });
      map.get(categorie.label).cmds.push(cmd);
    }
  }

  return PALIERS.map((palier) => {
    const lignesParGroupe = new Map();
    for (const [label, { emoji, cmds }] of parPalier[palier.cle]) {
      const entries = dedupeByIdentity(cmds).sort((a, b) => identityOf(a.cmd).localeCompare(identityOf(b.cmd)));
      lignesParGroupe.set(label, { emoji, lignes: entries.map((e) => formatLine(e, prefixes)) });
    }
    const { lines, count } = assemblerGroupes(lignesParGroupe);
    return { key: palier.cle, label: palier.titre, lines, count };
  }).filter((tier) => tier.count);
}

/**
 * @param {string} guildId
 * @param {import('discord.js').GuildMember} member
 * @param {{ tier?: string, page?: number }} [state]
 */
function buildHelpNavigator(guildId, member, state = {}) {
  const prefixes = getPrefixes(guildId);
  const prefix = prefixes[PREFIX_KEY];
  const tiers = buildTiersCatalogue(guildId, member);

  const tierKey = state.tier && tiers.some((t) => t.key === state.tier) ? state.tier : "accueil";
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${TITRE}\nVoici les commandes disponibles, filtrées selon tes permissions.`)
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  let pageCount = 1;
  let page = 0;
  if (tierKey === "accueil") {
    const lignes = tiers.map((t) => `**${t.label}** — ${t.count} commande(s)`);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(lignes.length ? lignes.join("\n") : "*Aucune commande accessible pour l'instant.*")
    );
  } else {
    const tier = tiers.find((t) => t.key === tierKey);
    const pages = paginerLignes(tier.lines);
    pageCount = pages.length;
    page = Math.min(Math.max(state.page || 0, 0), pageCount - 1);
    const titre = `**${tier.label}${pageCount > 1 ? ` (${page + 1}/${pageCount})` : ""}**`;
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${titre}\n${pages[page].join("\n")}`));
  }

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`> Préfixe : \`${prefix}\``));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  const options = [
    new StringSelectMenuOptionBuilder().setLabel("Accueil").setValue("accueil").setDefault(tierKey === "accueil"),
    ...tiers.map((t) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(`${t.label} (${t.count})`)
        .setValue(t.key)
        .setDefault(t.key === tierKey)
    ),
  ];
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`${CUSTOM_ID}:select`).setPlaceholder("Choisir un palier").addOptions(options)
    )
  );

  if (tierKey !== "accueil" && pageCount > 1) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_ID}:page:${tierKey}:${page - 1}`)
          .setLabel("Précédent")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_ID}:page:${tierKey}:${page + 1}`)
          .setLabel("Suivant")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === pageCount - 1)
      )
    );
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** Poste l'aide navigable et en retient le propriétaire (voir utils/messageOwner.js). */
async function repondreAvecAide(message) {
  return messageOwner.repondreEtRetenir(message, buildHelpNavigator(message.guild.id, message.member));
}

async function handleHelpNavInteraction(interaction) {
  const [, action, ...rest] = interaction.customId.split(":");

  let state;
  if (action === "select") {
    state = { tier: interaction.values[0], page: 0 };
  } else if (action === "page") {
    const [tier, page] = rest;
    state = { tier, page: Number(page) };
  } else {
    return;
  }

  return interaction.update(buildHelpNavigator(interaction.guild.id, interaction.member, state));
}

module.exports = {
  CUSTOM_ID,
  buildHelpNavigator,
  repondreAvecAide,
  handleHelpNavInteraction,
};
