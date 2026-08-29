/**
 * Rendu du panneau de partie en **Components V2** (container + séparateurs +
 * texte réduit), calqué sur la maquette :
 *
 *   ## 🎯 Partie personnalisée — Valorant
 *   Host : @hôte · Format : 5 vs 5
 *   ───────────────────────────────
 *   Statut : partie en cours — les salons vocaux des équipes ont été créés.
 *   ───────────────────────────────
 *   Équipe 1 — 5/5
 *   1. @joueur — `pseudo` · 🟫 Fer
 *   …
 *   ───────────────────────────────
 *   -# Les salons vocaux sont visibles par tout le monde, mais seuls les
 *      joueurs de chaque équipe peuvent s'y connecter, parler et stream.
 *   [ Terminer la partie ]
 *
 * Le message de partie est le SEUL message en V2 : les réponses courtes
 * (avertissement, proposition de place, erreurs) restent des embeds classiques.
 */

const {
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require("discord.js");

const config = require("../config");
const store = require("./store");
const settings = require("./settings");
const { formatRank, RANK_BY_KEY } = require("./ranks");
const { customId } = require("./embeds");

/** "5v5" → "5 vs 5", comme sur la maquette. */
const formatLabel = (format) => `${format.perTeam} vs ${format.perTeam}`;

const STATUS_LINE = {
  waiting: (match) => {
    const total = match.teams[1].length + match.teams[2].length;
    return `en attente de joueurs — **${total}/${match.format.perTeam * 2}** inscrits.`;
  },
  live: () => "partie en cours — les salons vocaux des équipes ont été créés.",
  ended: () => "partie terminée — les salons vocaux ont été supprimés.",
};

/** `1. @joueur — \`pseudo\` · 🟫 Fer` */
function playerLine(match, userId, index) {
  const profile = store.getProfile(userId);
  const pseudo = profile?.riotId ? ` — \`${profile.riotId}\`` : "";
  const rank = profile?.rank ? ` · ${formatRank(profile.rank)}` : "";
  const warning = match.warnings?.[userId];
  // Compte à rebours de l'avertissement, directement dans la liste.
  const warned = warning ? `  ${config.emojis.warn} <t:${Math.floor(warning.deadline / 1000)}:R>` : "";
  return `${index}. <@${userId}>${pseudo}${rank}${warned}`;
}

function teamBlock(match, teamNo) {
  const members = match.teams[teamNo];
  const size = match.format.perTeam;

  const lines = members.map((userId, i) => playerLine(match, userId, i + 1));
  for (let i = members.length; i < size; i += 1) lines.push(`${i + 1}. *place libre*`);

  const voice = match.voice?.[teamNo] ? `\n-# 🔊 <#${match.voice[teamNo]}>` : "";
  return `**Équipe ${teamNo} — ${members.length}/${size}**\n${lines.join("\n")}${voice}`;
}

function waitlistBlock(match) {
  if (!match.waitlist.length) return null;
  const lines = match.waitlist.slice(0, 10).map((userId, i) => playerLine(match, userId, i + 1));
  if (match.waitlist.length > 10) lines.push(`-# … et ${match.waitlist.length - 10} autre(s)`);
  return `**Liste d'attente — ${match.waitlist.length}**\n${lines.join("\n")}`;
}

const separator = () => new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small);
const text = (content) => new TextDisplayBuilder().setContent(content);

/** Boutons, selon l'état de la partie. */
function buildRows(match) {
  if (match.status === "ended") return [];

  const end = new ButtonBuilder()
    .setCustomId(customId("end", match.id))
    .setLabel("Terminer la partie")
    .setStyle(ButtonStyle.Danger);

  // Partie lancée : un seul bouton, comme sur la maquette. Les avertissements
  // passent par la commande `avertir` ou le panneau.
  if (match.status === "live") return [new ActionRowBuilder().addComponents(end)];

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(customId("join", match.id, "1")).setLabel("Rejoindre Équipe 1").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(customId("join", match.id, "2")).setLabel("Rejoindre Équipe 2").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(customId("waitlist", match.id)).setLabel("Liste d'attente").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(customId("leave", match.id)).setLabel("Quitter").setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(customId("start", match.id)).setLabel("Lancer la partie").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(customId("warn", match.id)).setLabel("Avertir un joueur").setStyle(ButtonStyle.Secondary),
      end,
    ),
  ];
}

/**
 * Panneau complet de la partie.
 * @returns {{flags: number, components: any[]}} prêt pour send() / edit()
 */
function buildMatchPanel(match) {
  const container = new ContainerBuilder().setAccentColor(config.colors.panel);

  // Titre
  const icon = config.emojis.valorant ? `${config.emojis.valorant} ` : "";
  container.addTextDisplayComponents(text(`## ${icon}Partie personnalisée — Valorant`));

  // Hôte / format / map / rang minimum
  const header = [`**Host** : <@${match.hostId}>`, `**Format** : ${formatLabel(match.format)}`];
  if (match.map) header.push(`**Map** : ${match.map}`);
  if (match.minRank) {
    const rank = RANK_BY_KEY.get(match.minRank);
    if (rank) header.push(`**Rang min.** : ${rank.emoji} ${rank.label}`);
  }
  container.addTextDisplayComponents(text(header.join(" · ")));

  container.addSeparatorComponents(separator());

  // Statut
  container.addTextDisplayComponents(text(`**Statut** : ${STATUS_LINE[match.status](match)}`));

  container.addSeparatorComponents(separator());

  // Équipes
  container.addTextDisplayComponents(text(teamBlock(match, 1)));
  container.addTextDisplayComponents(text(teamBlock(match, 2)));

  const waitlist = waitlistBlock(match);
  if (waitlist) {
    container.addSeparatorComponents(separator());
    container.addTextDisplayComponents(text(waitlist));
  }

  container.addSeparatorComponents(separator());

  // Note de bas de panneau, en texte réduit
  container.addTextDisplayComponents(text(
    "-# Les salons vocaux sont visibles par tout le monde, mais seuls les joueurs de chaque équipe peuvent s'y connecter, parler et stream.",
  ));

  for (const row of buildRows(match)) container.addActionRowComponents(row);

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Petit panneau V2 générique — utilisé pour l'ouverture du panneau de contrôle
 * et les annonces qui méritent le même habillage que la partie.
 */
function buildSimplePanel({ title, body, rows = [], accent = config.colors.panel }) {
  const container = new ContainerBuilder().setAccentColor(accent);
  if (title) container.addTextDisplayComponents(text(`## ${title}`));
  if (body) container.addTextDisplayComponents(text(body));
  for (const row of rows) container.addActionRowComponents(row);
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** Préfixe courant, utilisé dans les textes d'aide. */
const prefix = () => settings.get("prefix");

module.exports = { buildMatchPanel, buildSimplePanel, formatLabel, prefix };
