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
const { groupByPalier, dedupeByIdentity, formatLine, PALIERS, identityOf } = require("./helpPanel");
const messageOwner = require("./messageOwner");

// Remplace l'ancien "&help" en texte pur qui postait PLUSIEURS messages
// séparés dès qu'un palier dépassait la limite Discord (155 commandes
// "configurables" -> jusqu'à 4 messages d'un coup). Un seul message,
// navigable via un menu déroulant ("Choisir un palier") + Précédent/Suivant
// quand un palier ne tient pas sur une page — jamais de nouveau message
// posté après le premier.
const CUSTOM_ID = "helpnav";

// Un bucket par préfixe qui utilise ce composant. "!!"/"=" gardent leurs
// propres cartes statiques (utils/protectionHelpCommand.js,
// utils/voiceHelpCommand.js) : listes courtes, jamais de pagination à
// gérer, pas de raison de les faire passer par ce moteur.
const BUCKETS = {
  gestion: { titre: "Aide", prefixKey: "musicMod" },
  moderation: { titre: "Aide — Modération", prefixKey: "moderation" },
};

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

/** Paliers non vides pour ce bucket, avec leurs lignes déjà formatées. */
function buildTiers(bucket, guildId, member) {
  const prefixes = getPrefixes(guildId);
  const groups = groupByPalier(member, bucket);
  return PALIERS.map((palier) => {
    const entries = dedupeByIdentity(groups[palier.cle]).sort((a, b) => identityOf(a.cmd).localeCompare(identityOf(b.cmd)));
    return { key: palier.cle, label: palier.titre, lines: entries.map((e) => formatLine(e, prefixes)) };
  }).filter((tier) => tier.lines.length);
}

/**
 * @param {"gestion"|"moderation"} bucketKey
 * @param {string} guildId
 * @param {import('discord.js').GuildMember} member
 * @param {{ tier?: string, page?: number }} [state]
 */
function buildHelpNavigator(bucketKey, guildId, member, state = {}) {
  const bucket = BUCKETS[bucketKey];
  const prefixes = getPrefixes(guildId);
  const prefix = prefixes[bucket.prefixKey];
  const tiers = buildTiers(bucketKey, guildId, member);

  const tierKey = state.tier && tiers.some((t) => t.key === state.tier) ? state.tier : "accueil";
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${bucket.titre}\nVoici les commandes disponibles, filtrées selon tes permissions.`)
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  let pageCount = 1;
  let page = 0;
  if (tierKey === "accueil") {
    const lignes = tiers.map((t) => `**${t.label}** — ${t.lines.length} commande(s)`);
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
        .setLabel(`${t.label} (${t.lines.length})`)
        .setValue(t.key)
        .setDefault(t.key === tierKey)
    ),
  ];
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`${CUSTOM_ID}:select:${bucketKey}`).setPlaceholder("Choisir un palier").addOptions(options)
    )
  );

  if (tierKey !== "accueil" && pageCount > 1) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_ID}:page:${bucketKey}:${tierKey}:${page - 1}`)
          .setLabel("Précédent")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0),
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_ID}:page:${bucketKey}:${tierKey}:${page + 1}`)
          .setLabel("Suivant")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === pageCount - 1)
      )
    );
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** Poste l'aide navigable et en retient le propriétaire (voir utils/messageOwner.js). */
async function repondreAvecAide(bucketKey, message) {
  return messageOwner.repondreEtRetenir(message, buildHelpNavigator(bucketKey, message.guild.id, message.member));
}

async function handleHelpNavInteraction(interaction) {
  const [, action, bucketKey, ...rest] = interaction.customId.split(":");
  if (!BUCKETS[bucketKey]) return;

  let state;
  if (action === "select") {
    state = { tier: interaction.values[0], page: 0 };
  } else if (action === "page") {
    const [tier, page] = rest;
    state = { tier, page: Number(page) };
  } else {
    return;
  }

  return interaction.update(buildHelpNavigator(bucketKey, interaction.guild.id, interaction.member, state));
}

module.exports = { CUSTOM_ID, buildHelpNavigator, repondreAvecAide, handleHelpNavInteraction };
