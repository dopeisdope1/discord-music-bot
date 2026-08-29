/**
 * ═══════════════════════════════════════════════════════════════════════
 *  PANNEAU DE PARTIE — Components V2
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Un seul message, entièrement construit en V2 (`ContainerBuilder`), qui reste
 * la **source de vérité publique** de la partie :
 *
 *   ┌ Container (barre d'accent = état de la partie) ────────────────────┐
 *   │ Section  ## 🎮 Partie personnalisée — Valorant      [avatar hôte]  │
 *   │          Hôte · Format · Map · Rang minimum                        │
 *   │ ───────────────────────────────────────────────────────────────── │
 *   │ Statut   🟡 en attente · 7/10   /   🔴 en cours   /   ⚫ terminée   │
 *   │ ───────────────────────────────────────────────────────────────── │
 *   │ Section  🔴 ÉQUIPE 1 — 5/5                      [ Rejoindre ]      │
 *   │          1. @joueur — `Snow#EUW` · 💎 Diamant 2 · 54 RR   🟢       │
 *   │ Section  🔵 ÉQUIPE 2 — 4/5                      [ Rejoindre ]      │
 *   │ ───────────────────────────────────────────────────────────────── │
 *   │ 🎙️ Vocaux · ⚠️ Absents · 🔓 Places libres                          │
 *   │ ───────────────────────────────────────────────────────────────── │
 *   │ [ 🎮 Rejoindre ] [ 🕐 Attente ] [ 🚪 Quitter ] [ 🔗 ] [ 🔄 ]        │
 *   │ [ ▶️ Lancer ] [ ⚖️ Équilibrer ] [ ⚠️ Avertir ] [ 🛑 Terminer ]      │
 *   │ -# note de bas de panneau                                          │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Les **Sections** portent un bouton accessoire (« Rejoindre » collé à
 * l'équipe concernée) : c'est ce que Components V2 apporte de plus lisible
 * par rapport à un embed, où les boutons flottent tous en bas.
 *
 * Ce module ne fait AUCUN appel réseau et n'a aucun effet de bord : il reçoit
 * un état et rend des composants. La présence en vocal lui est fournie sous
 * forme de photo (`presence`), lue dans le cache par utils/voice.js.
 */

const {
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  SectionBuilder, ThumbnailBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require("discord.js");

const config = require("../config");
const store = require("./store");
const settings = require("./settings");
const { rankEmoji, RANK_BY_KEY } = require("./ranks");
const { formatProfileRank } = require("./rankService");
const { customId } = require("./embeds");

// ────────────────────────── briques de base ──────────────────────────

const text = (content) => new TextDisplayBuilder().setContent(content);
const separator = (large = false) =>
  new SeparatorBuilder().setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);
/** Séparateur invisible : de l'air, sans trait. */
const spacer = () => new SeparatorBuilder().setDivider(false).setSpacing(SeparatorSpacingSize.Small);

/** "5v5" → "5 vs 5", comme sur la maquette. */
const formatLabel = (format) => `${format.perTeam} vs ${format.perTeam}`;

/** Horodatage relatif Discord : le compte à rebours s'anime côté client, sans
 *  qu'on ait à ré-éditer le message chaque seconde. */
const relative = (timestampMs) => `<t:${Math.floor(timestampMs / 1000)}:R>`;
const clock = (timestampMs) => `<t:${Math.floor(timestampMs / 1000)}:t>`;

const playerCount = (match) => match.teams[1].length + match.teams[2].length;
const capacity = (match) => match.format.perTeam * 2;
const isFull = (match) => playerCount(match) >= capacity(match);

// ─────────────────────────────── statut ───────────────────────────────

const ACCENT = {
  waiting: config.colors.waiting,
  live: config.colors.live,
  ended: config.colors.ended,
};

function statusLine(match) {
  if (match.status === "ended") return "⚫ **Terminée** — les salons vocaux ont été supprimés.";
  if (match.status === "live") {
    return "🔴 **En cours** — les salons vocaux des équipes sont ouverts.";
  }

  const total = playerCount(match);
  if (isFull(match)) {
    return `🟢 **Complète** — ${total}/${capacity(match)} joueurs, prête à démarrer.`;
  }

  const line = `🟡 **En attente** — **${total}/${capacity(match)}** inscrits.`;
  return match.startAt
    ? `${line}\n⏰ Lancement automatique ${clock(match.startAt)} (${relative(match.startAt)})`
    : line;
}

// ─────────────────────────────── joueurs ───────────────────────────────

/**
 * `1.` @joueur — `Snow#EUW` · 💎 Diamant 2 · 54 RR  🟢
 *
 * L'ordre est volontairement toujours le même : numéro, mention, Riot ID,
 * rang, état. Une colonne mentalement stable se lit beaucoup plus vite qu'une
 * ligne dont la forme change d'un joueur à l'autre.
 */
function playerLine(match, userId, index, presence) {
  const profile = store.getProfile(userId);
  const parts = [`\`${index}.\``, `<@${userId}>`];

  if (profile?.riotId) parts.push(`— \`${profile.riotId}\``);
  parts.push(`· ${formatProfileRank(profile)}`);

  const warning = match.warnings?.[userId];
  if (warning) {
    // Compte à rebours vivant, sans ré-édition du message.
    parts.push(`  ${config.emojis.warn} ${relative(warning.deadline)}`);
  } else if (presence?.has(userId)) {
    parts.push(`  ${presence.get(userId) ? config.emojis.present : config.emojis.absent}`);
  }

  return parts.join(" ");
}

function teamBody(match, teamNo, presence) {
  const members = match.teams[teamNo];
  const size = match.format.perTeam;
  const emoji = teamNo === 1 ? config.emojis.team1 : config.emojis.team2;

  const lines = members.map((userId, index) => playerLine(match, userId, index + 1, presence));
  for (let i = members.length; i < size; i += 1) lines.push(`\`${i + 1}.\` *place libre*`);

  const header = `${emoji} **ÉQUIPE ${teamNo}** — ${members.length}/${size}`;
  const voice = match.voice?.[teamNo] ? `\n-# ${config.emojis.voice} <#${match.voice[teamNo]}>` : "";

  return `${header}\n${lines.join("\n")}${voice}`;
}

/**
 * Bloc d'équipe : une **Section** avec son bouton « Rejoindre » quand il reste
 * de la place, un simple texte sinon (une Section exige un accessoire).
 */
function teamComponent(match, teamNo, presence) {
  const body = teamBody(match, teamNo, presence);
  const open = match.status === "waiting" && match.teams[teamNo].length < match.format.perTeam;

  if (!open) return { kind: "text", component: text(body) };

  return {
    kind: "section",
    component: new SectionBuilder()
      .addTextDisplayComponents(text(body))
      .setButtonAccessory(
        new ButtonBuilder()
          .setCustomId(customId("join", match.id, String(teamNo)))
          .setLabel("Rejoindre")
          .setEmoji(teamNo === 1 ? config.emojis.team1 : config.emojis.team2)
          .setStyle(ButtonStyle.Secondary),
      ),
  };
}

function waitlistBlock(match) {
  if (!match.waitlist.length) return null;
  const lines = match.waitlist.slice(0, 10).map((userId, index) => playerLine(match, userId, index + 1, null));
  if (match.waitlist.length > 10) lines.push(`-# … et ${match.waitlist.length - 10} autre(s)`);
  return `${config.emojis.waitlist} **LISTE D'ATTENTE** — ${match.waitlist.length}\n${lines.join("\n")}`;
}

// ──────────────────────── absences & places libres ────────────────────────

/**
 * Bloc « joueur absent » : un seul message, un seul ping (fait ailleurs), et
 * un compte à rebours qui descend tout seul côté client.
 */
function absenceBlock(match) {
  const entries = Object.entries(match.warnings || {});
  if (!entries.length) return null;

  const lines = entries.map(([userId, warning]) =>
    `<@${userId}> · Équipe ${warning.teamNo} · ⏱️ ${relative(warning.deadline)}`);

  return [
    `${config.emojis.warn} **JOUEUR${entries.length > 1 ? "S" : ""} ABSENT${entries.length > 1 ? "S" : ""}**`,
    ...lines,
    `-# Sans réponse avant la fin du délai, la place est libérée et proposée à quelqu'un d'autre.`,
  ].join("\n");
}

/** Bloc « place disponible » — présent tant qu'une offre est ouverte. */
function freeSpotBlock(match) {
  const open = Object.entries(match.offers || {}).filter(([teamNo]) => match.teams[teamNo]?.length < match.format.perTeam);
  if (!open.length) return null;

  const lines = open.map(([teamNo, offer]) => {
    const reserved = offer.reservedUntil > Date.now()
      ? ` — réservée à la liste d'attente jusqu'à ${clock(offer.reservedUntil)}`
      : "";
    return `🔓 **Équipe ${teamNo}**${reserved}`;
  });

  return [`${config.emojis.claim} **PLACE${open.length > 1 ? "S" : ""} DISPONIBLE${open.length > 1 ? "S" : ""}**`, ...lines].join("\n");
}

/** Récapitulatif vocal + présence, affiché une fois la partie lancée. */
function voiceBlock(match, presence) {
  if (match.status !== "live" || (!match.voice?.[1] && !match.voice?.[2])) return null;

  const players = [...match.teams[1], ...match.teams[2]];
  const present = players.filter((userId) => presence?.get(userId)).length;
  const all = players.length;

  const state = present === all && all > 0
    ? `${config.emojis.present} **Tous les joueurs sont présents.**`
    : `${config.emojis.absent} **${all - present}** joueur(s) ne sont pas dans le vocal de leur équipe.`;

  return [
    `${config.emojis.voice} **VOCAUX**`,
    `${config.emojis.team1} <#${match.voice[1]}>  ·  ${config.emojis.team2} <#${match.voice[2]}>`,
    "",
    state,
  ].join("\n");
}

// ─────────────────────────────── boutons ───────────────────────────────

const button = (id, label, emoji, style = ButtonStyle.Secondary, disabled = false) =>
  new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style).setDisabled(disabled);

/**
 * Boutons selon l'état de la partie.
 *
 * Un bouton est partagé par tout le serveur : impossible de le désactiver
 * « pour ceux qui sont déjà inscrits » seulement. On désactive donc sur l'état
 * global (partie pleine, terminée) et chaque clic est revérifié côté serveur,
 * avec une réponse privée expliquant le refus.
 */
function buildRows(match) {
  if (match.status === "ended") return [];

  const end = button(customId("end", match.id), "Terminer la partie", config.emojis.end, ButtonStyle.Danger);
  const refresh = button(customId("refresh", match.id), "Actualiser", config.emojis.refresh);

  // ---- Partie lancée ----
  if (match.status === "live") {
    const rows = [
      new ActionRowBuilder().addComponents(
        button(customId("myvoice", match.id), "Mon vocal", config.emojis.voice, ButtonStyle.Primary),
        button(customId("teams", match.id), "Voir les équipes", "👥"),
        refresh,
        end,
      ),
    ];

    // Une place s'est libérée en cours de partie : le bouton apparaît ici aussi,
    // pas seulement dans l'annonce, qui a pu remonter loin dans le salon.
    const free = Object.keys(match.offers || {})
      .filter((teamNo) => match.teams[teamNo]?.length < match.format.perTeam)
      .slice(0, 2);
    if (free.length && settings.get("allowReplacement")) {
      rows.push(new ActionRowBuilder().addComponents(
        ...free.map((teamNo) => button(
          customId("claim", match.id, String(teamNo)),
          `Prendre la place — Équipe ${teamNo}`,
          config.emojis.claim,
          ButtonStyle.Success,
        )),
      ));
    }
    return rows;
  }

  // ---- En attente d'inscriptions ----
  const full = isFull(match);

  const first = new ActionRowBuilder().addComponents(
    button(
      customId("join-auto", match.id),
      full ? "Partie complète" : "Rejoindre la partie",
      "🎮",
      ButtonStyle.Success,
      full,
    ),
    button(customId("waitlist", match.id), "Liste d'attente", config.emojis.waitlist),
    button(customId("leave", match.id), "Quitter", config.emojis.leave),
    button(customId("link", match.id), "Mon compte Riot", config.emojis.link),
    refresh,
  );

  const second = new ActionRowBuilder().addComponents(
    button(customId("start", match.id), "Lancer la partie", config.emojis.start, ButtonStyle.Primary),
    button(customId("balance", match.id), "Équilibrer", config.emojis.balance),
    button(customId("warn", match.id), "Avertir un joueur", config.emojis.warn),
    end,
  );

  return [first, second];
}

// ──────────────────────────── panneau complet ────────────────────────────

/**
 * Panneau complet de la partie.
 *
 * @param {object} match
 * @param {{presence?: Map<string, boolean>}} options photo de la présence en
 *        vocal (facultative : sans elle, aucun 🟢/🔴 n'est affiché).
 * @returns {{flags: number, components: any[]}} prêt pour send() / edit()
 */
function buildMatchPanel(match, { presence = null } = {}) {
  const container = new ContainerBuilder().setAccentColor(ACCENT[match.status] ?? config.colors.panel);

  // ---- En-tête : titre + méta, avec l'avatar de l'hôte en vignette ----
  const titleEmoji = settings.get("titleEmoji") || config.emojis.valorant;
  const icon = titleEmoji ? `${titleEmoji} ` : "🎮 ";

  const meta = [`${config.emojis.host} <@${match.hostId}>`, `**${formatLabel(match.format)}**`];
  if (match.map) meta.push(`${config.emojis.map} ${match.map}`);
  if (match.minRank) {
    const rank = RANK_BY_KEY.get(match.minRank);
    if (rank) meta.push(`${rankEmoji(rank.key)} ${rank.label} min.`);
  }

  const heading = `## ${icon}Partie personnalisée — Valorant\n${meta.join("  ·  ")}`;

  if (match.hostAvatar) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(heading))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(match.hostAvatar).setDescription("Hôte de la partie")),
    );
  } else {
    container.addTextDisplayComponents(text(heading));
  }

  container.addSeparatorComponents(separator());

  // ---- Statut ----
  container.addTextDisplayComponents(text(statusLine(match)));
  container.addSeparatorComponents(separator());

  // ---- Équipes ----
  for (const teamNo of [1, 2]) {
    const block = teamComponent(match, teamNo, presence);
    if (block.kind === "section") container.addSectionComponents(block.component);
    else container.addTextDisplayComponents(block.component);
    if (teamNo === 1) container.addSeparatorComponents(spacer());
  }

  // ---- Liste d'attente ----
  const waitlist = waitlistBlock(match);
  if (waitlist) {
    container.addSeparatorComponents(separator());
    container.addTextDisplayComponents(text(waitlist));
  }

  // ---- Vocaux / absences / places libres ----
  const blocks = [voiceBlock(match, presence), absenceBlock(match), freeSpotBlock(match)].filter(Boolean);
  if (blocks.length) {
    container.addSeparatorComponents(separator());
    container.addTextDisplayComponents(text(blocks.join("\n\n")));
  }

  container.addSeparatorComponents(separator());

  // ---- Boutons ----
  for (const row of buildRows(match)) container.addActionRowComponents(row);

  // ---- Note de bas de panneau ----
  container.addTextDisplayComponents(text([
    "-# Les salons vocaux sont visibles par tout le monde, mais seuls les joueurs",
    "-# de chaque équipe peuvent s'y connecter, parler et stream.",
    `-# Partie \`#${match.id}\``,
  ].join("\n")));

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

// ───────────────────────── panneaux génériques V2 ─────────────────────────

/**
 * Vue V2 réutilisable — utilisée par le panneau de contrôle et les annonces qui
 * méritent le même habillage que la partie.
 *
 * @param {object} options
 * @param {string}   options.title
 * @param {string|string[]} options.body
 * @param {any[]}    options.rows      ActionRow(s)
 * @param {any[]}    options.sections  SectionBuilder(s) insérées avant les boutons
 * @param {string}   options.notice    bandeau de résultat (✅ / ❌) en bas
 * @param {string}   options.footer    texte réduit de bas de panneau
 * @param {number}   options.accent
 * @param {boolean}  options.ephemeral ajoute le flag éphémère
 */
function panelView({
  title = null, body = null, rows = [], sections = [],
  notice = null, footer = null, accent = config.colors.panel, ephemeral = false,
} = {}) {
  const container = new ContainerBuilder().setAccentColor(accent);

  if (title) container.addTextDisplayComponents(text(`## ${title}`));

  const content = Array.isArray(body) ? body.filter((line) => line !== null).join("\n") : body;
  if (content) {
    if (title) container.addSeparatorComponents(separator());
    container.addTextDisplayComponents(text(content));
  }

  for (const section of sections) container.addSectionComponents(section);

  if (notice) {
    container.addSeparatorComponents(separator());
    container.addTextDisplayComponents(text(notice));
  }

  if (rows.length) {
    container.addSeparatorComponents(spacer());
    for (const row of rows) container.addActionRowComponents(row);
  }

  if (footer) container.addTextDisplayComponents(text(footer));

  const flags = ephemeral
    ? MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    : MessageFlags.IsComponentsV2;

  return { flags, components: [container] };
}

/** Compatibilité : ancien nom, même rendu. */
const buildSimplePanel = ({ title, body, rows = [], accent = config.colors.panel }) =>
  panelView({ title, body, rows, accent });

/** Préfixe courant, utilisé dans les textes d'aide. */
const prefix = () => settings.get("prefix");

module.exports = {
  buildMatchPanel, buildSimplePanel, panelView,
  formatLabel, prefix,
  // briques réutilisables par le panneau de contrôle
  text, separator, spacer, relative, clock,
};
