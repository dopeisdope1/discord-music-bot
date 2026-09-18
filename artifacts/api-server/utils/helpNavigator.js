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
const { groupByPalier, dedupeByIdentity, formatLine, PALIERS, identityOf, estDangereux } = require("./helpPanel");
const { can } = require("./permissions/engine");
const { COMMANDES: COMMANDES_SECURITE } = require("./protectionHelpCommand");
const { CATEGORIES: CATEGORIES_VOCAL } = require("./voiceHelpCommand");
const messageOwner = require("./messageOwner");

// Remplace les 4 "help" en texte pur/carte figée (&help, -help, !!help,
// =help) par le MÊME moteur : un seul message, navigable via un menu
// déroulant ("Choisir un palier") + Précédent/Suivant quand un groupe ne
// tient pas sur une page — jamais de nouveau message posté après le
// premier. "!!help"/"=help" restaient sur leurs cartes figées (utils/
// protectionHelpCommand.js, utils/voiceHelpCommand.js) : leurs listes
// COMMANDES/CATEGORIES restent la source de vérité (le catalogue partagé,
// utils/commandCatalog.js, ne référence QUE "&"/"-", voir utils/
// commandRouting.js) — seule la PRÉSENTATION est unifiée ici.
const CUSTOM_ID = "helpnav";

// Un bucket par préfixe, TOUS sur les mêmes paliers Publiques/Configurables/
// Sys (utils/helpPanel.js::PALIERS) — "gestion"/"moderation" les tirent du
// catalogue central, "securite"/"vocal" de leurs listes figées existantes
// (utils/protectionHelpCommand.js, utils/voiceHelpCommand.js), mais avec la
// même classification "dangereux -> Sys" (estDangereux).
const BUCKETS = {
  gestion: { titre: "Aide", prefixKey: "musicMod", tiersFn: (guildId, member) => buildTiersCatalogue("gestion", guildId, member) },
  moderation: { titre: "Aide — Modération", prefixKey: "moderation", tiersFn: (guildId, member) => buildTiersCatalogue("moderation", guildId, member) },
  securite: { titre: "Aide — Sécurité", prefixKey: "protection", tiersFn: buildTiersSecurite },
  vocal: { titre: "Aide — Vocal", prefixKey: "owner", tiersFn: buildTiersVocal },
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

/** Paliers de droit (public/configurable/sys) non vides, catalogue central — pour "&help"/"-help". */
function buildTiersCatalogue(bucket, guildId, member) {
  const prefixes = getPrefixes(guildId);
  const groups = groupByPalier(member, bucket);
  return PALIERS.map((palier) => {
    const entries = dedupeByIdentity(groups[palier.cle]).sort((a, b) => identityOf(a.cmd).localeCompare(identityOf(b.cmd)));
    return { key: palier.cle, label: palier.titre, lines: entries.map((e) => formatLine(e, prefixes)) };
  }).filter((tier) => tier.lines.length);
}

/** Une ligne au même format que formatLine (utils/helpPanel.js), pour les listes figées "!!"/"=". */
function ligneFigee(nom, description, marqueur, prefix) {
  return `> \`${nom.replaceAll(marqueur, prefix)}\` (${description.replaceAll(marqueur, prefix)})`;
}

/** Palier public/configurable/sys d'une commande "!!"/"=" — mêmes règles que le catalogue (utils/helpPanel.js::estDangereux). */
function palierFige(permission) {
  if (!permission) return "public";
  return estDangereux(permission) ? "sys" : "configurable";
}

/** Paliers non vides du "!!" — utils/protectionHelpCommand.js reste la source de vérité des commandes. */
function buildTiersSecurite(guildId, member) {
  const prefix = getPrefixes(guildId).protection;
  const groupes = { public: [], configurable: [], sys: [] };
  for (const c of COMMANDES_SECURITE) {
    if (c.nom.replace(/^!!/, "").split(/\s+/)[0] === "help") continue; // la commande elle-même, jamais listée
    if (!can(member, c.permission)) continue;
    groupes[palierFige(c.permission)].push(ligneFigee(c.nom, c.description, "!!", prefix));
  }
  return PALIERS.map((p) => ({ key: p.cle, label: p.titre, lines: groupes[p.cle] })).filter((t) => t.lines.length);
}

/** Paliers non vides du "=" — utils/voiceHelpCommand.js reste la source de vérité des commandes. */
function buildTiersVocal(guildId, member) {
  const prefix = getPrefixes(guildId).owner;
  const groupes = { public: [], configurable: [], sys: [] };
  for (const cat of CATEGORIES_VOCAL) {
    for (const c of cat.commandes) {
      if (c.nom.replace(/^=/, "").split(/\s+/)[0] === "help") continue;
      if (!can(member, c.permission)) continue;
      groupes[palierFige(c.permission)].push(ligneFigee(c.nom, c.description, "=", prefix));
    }
  }
  return PALIERS.map((p) => ({ key: p.cle, label: p.titre, lines: groupes[p.cle] })).filter((t) => t.lines.length);
}

/**
 * @param {"gestion"|"moderation"|"securite"|"vocal"} bucketKey
 * @param {string} guildId
 * @param {import('discord.js').GuildMember} member
 * @param {{ tier?: string, page?: number }} [state]
 */
function buildHelpNavigator(bucketKey, guildId, member, state = {}) {
  const bucket = BUCKETS[bucketKey];
  const prefixes = getPrefixes(guildId);
  const prefix = prefixes[bucket.prefixKey];
  const tiers = bucket.tiersFn(guildId, member);

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

/** "!!help" — voir utils/protectionHelpCommand.js (COMMANDES, source de vérité). */
async function handleSecuriteHelpTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;
  const content = message.content.trim();
  const { protection: PREFIX } = getPrefixes(message.guild.id);
  if (!PREFIX || !content.startsWith(PREFIX)) return;
  const [cmd] = content.slice(PREFIX.length).trim().split(/\s+/);
  if ((cmd || "").toLowerCase() !== "help") return;
  return repondreAvecAide("securite", message);
}

/** "=help" — voir utils/voiceHelpCommand.js (CATEGORIES, source de vérité). */
async function handleVocalHelpTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;
  const content = message.content.trim();
  const { owner: PREFIX } = getPrefixes(message.guild.id);
  if (!PREFIX || !content.startsWith(PREFIX)) return;
  const [cmd] = content.slice(PREFIX.length).trim().split(/\s+/);
  if ((cmd || "").toLowerCase() !== "help") return;
  return repondreAvecAide("vocal", message);
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

module.exports = {
  CUSTOM_ID,
  buildHelpNavigator,
  repondreAvecAide,
  handleHelpNavInteraction,
  handleSecuriteHelpTextCommand,
  handleVocalHelpTextCommand,
};
