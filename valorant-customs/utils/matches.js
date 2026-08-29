/**
 * Modèle « partie » + helpers de rafraîchissement du message Discord.
 *
 * Ce module ne gère AUCUN timer (voir utils/warnings.js) : il reste ainsi
 * importable partout sans créer de dépendance circulaire.
 *
 * Forme d'une partie stockée :
 * {
 *   id, guildId, channelId, messageId, hostId, createdAt,
 *   format: { key, label, perTeam },
 *   map: string|null,
 *   minRank: string|null,          // clé de rang (ex. "diamond")
 *   status: "waiting" | "live" | "ended",
 *   startAt: number|null,           // lancement programmé
 *   teams: { 1: [userId], 2: [userId] },
 *   waitlist: [userId],
 *   voice: { 1: channelId|null, 2: channelId|null },
 *   warnings: { [userId]: { deadline, teamNo, issuerId, noticeId } },
 *   offers: { [teamNo]: { userId, deadline, messageId } }
 * }
 */

const store = require("./store");
const { buildMatchPanel } = require("./display");
const { presenceSnapshot } = require("./voice");

function createMatch({ guildId, channelId, hostId, hostAvatar = null, format, map, minRank, startAt }) {
  return {
    id: store.newMatchId(),
    guildId,
    channelId,
    messageId: null,
    hostId,
    // Vignette du panneau : évite d'aller chercher l'utilisateur à chaque rendu.
    hostAvatar: hostAvatar || null,
    createdAt: Date.now(),
    startedAt: null,
    format,
    map: map || null,
    minRank: minRank || null,
    status: "waiting",
    // Heure de lancement programmée (timestamp ms) ou null.
    startAt: startAt || null,
    teams: { 1: [], 2: [] },
    waitlist: [],
    voice: { 1: null, 2: null },
    warnings: {},
    offers: {},
  };
}

/** @returns {1|2|null} l'équipe du joueur, ou null s'il n'est dans aucune. */
function findTeam(match, userId) {
  if (match.teams[1].includes(userId)) return 1;
  if (match.teams[2].includes(userId)) return 2;
  return null;
}

const isInWaitlist = (match, userId) => match.waitlist.includes(userId);
const isInMatch = (match, userId) => findTeam(match, userId) !== null || isInWaitlist(match, userId);
const teamIsFull = (match, teamNo) => match.teams[teamNo].length >= match.format.perTeam;
const playerCount = (match) => match.teams[1].length + match.teams[2].length;

/** Retire le joueur de partout (équipes + liste d'attente). */
function removePlayer(match, userId) {
  const teamNo = findTeam(match, userId);
  if (teamNo) match.teams[teamNo] = match.teams[teamNo].filter((id) => id !== userId);
  match.waitlist = match.waitlist.filter((id) => id !== userId);
  delete match.warnings[userId];
  return teamNo;
}

/** Ajoute dans une équipe (le joueur est d'abord retiré de son ancienne place). */
function addToTeam(match, userId, teamNo) {
  removePlayer(match, userId);
  match.teams[teamNo].push(userId);
}

function addToWaitlist(match, userId) {
  removePlayer(match, userId);
  match.waitlist.push(userId);
}

// ---- Accès au message Discord de la partie ----

/** @returns {Promise<import('discord.js').TextChannel|null>} */
async function fetchMatchChannel(client, match) {
  try {
    const channel = await client.channels.fetch(match.channelId);
    return channel?.isTextBased() ? channel : null;
  } catch {
    return null; // salon supprimé ou bot sans accès
  }
}

// ---- Rafraîchissement du panneau, sans matraquer l'API ----

// Discord limite les éditions d'un même message. Cinq joueurs qui cliquent
// dans la même seconde ne doivent pas déclencher cinq éditions : on regroupe.
const MIN_EDIT_INTERVAL_MS = 1_200;
/** @type {Map<string, number>} matchId → horodatage de la dernière édition */
const lastEdit = new Map();
/** @type {Map<string, NodeJS.Timeout>} édition différée déjà programmée */
const pendingEdit = new Map();

/** Rendu du panneau avec la présence vocale lue dans le cache. */
function renderMatchPanel(client, match) {
  const guild = client.guilds.cache.get(match.guildId) || null;
  const presence = guild ? presenceSnapshot(guild, match) : null;
  return buildMatchPanel(match, { presence });
}

async function editMatchMessage(client, match) {
  lastEdit.set(match.id, Date.now());
  const channel = await fetchMatchChannel(client, match);
  if (!channel) return;
  try {
    const message = await channel.messages.fetch(match.messageId);
    await message.edit(renderMatchPanel(client, match));
  } catch (error) {
    // Message supprimé à la main : on n'insiste pas, la partie reste pilotable
    // par les commandes et le panneau de contrôle.
    console.error(`[matches] Rafraîchissement impossible (#${match.id}) :`, error.message);
  }
}

/**
 * Ré-affiche le panneau de la partie à partir de son état courant.
 *
 * Les appels rapprochés sont fusionnés : le dernier état gagne, et une seule
 * édition part réellement. Les minuteries sont `unref()` — elles n'empêchent
 * jamais le process de s'arrêter.
 */
async function refreshMatchMessage(client, match) {
  if (!match.messageId) return;

  const since = Date.now() - (lastEdit.get(match.id) || 0);
  if (since >= MIN_EDIT_INTERVAL_MS) {
    const timer = pendingEdit.get(match.id);
    if (timer) {
      clearTimeout(timer);
      pendingEdit.delete(match.id);
    }
    return editMatchMessage(client, match);
  }

  // Une édition différée est déjà programmée : elle prendra l'état à jour.
  if (pendingEdit.has(match.id)) return;

  const timer = setTimeout(() => {
    pendingEdit.delete(match.id);
    // On relit la partie : elle a pu être terminée entre-temps.
    const current = store.getMatch(match.id) || match;
    editMatchMessage(client, current).catch(() => {});
  }, MIN_EDIT_INTERVAL_MS - since);

  timer.unref?.();
  pendingEdit.set(match.id, timer);
}

/** Coupe les éditions différées d'une partie (fin de partie / purge). */
function cancelRefresh(matchId) {
  const timer = pendingEdit.get(matchId);
  if (timer) clearTimeout(timer);
  pendingEdit.delete(matchId);
  lastEdit.delete(matchId);
}

/**
 * Envoie un message public dans le salon de la partie.
 * Par défaut aucun ping — `mentionUsers` liste les seuls IDs à notifier
 * réellement (l'avertissement anti-absent DOIT pinger, lui).
 */
async function announce(client, match, { content, embeds = [], components = [], mentionUsers = [] }) {
  const channel = await fetchMatchChannel(client, match);
  if (!channel) return null;
  try {
    return await channel.send({
      content,
      embeds,
      components,
      allowedMentions: { parse: [], users: mentionUsers },
    });
  } catch (error) {
    console.error(`[matches] Envoi impossible dans le salon de la partie #${match.id} :`, error.message);
    return null;
  }
}

/** Retrouve la partie active liée à un message (utile pour /avertir sans ID). */
function findMatchByMessage(messageId) {
  return store.allMatches().find((match) => match.messageId === messageId) || null;
}

/** La partie « courante » d'un salon : la plus récente encore ouverte. */
function findActiveMatchInChannel(channelId) {
  return store
    .allMatches()
    .filter((match) => match.channelId === channelId && match.status !== "ended")
    .sort((a, b) => b.createdAt - a.createdAt)[0] || null;
}

/** Toutes les parties ouvertes où le joueur est inscrit (équipe ou attente). */
function findMatchesForPlayer(guildId, userId) {
  return store
    .allMatches()
    .filter((match) => match.guildId === guildId && match.status !== "ended" && isInMatch(match, userId));
}

/** La partie est-elle au complet ? */
const matchIsFull = (match) => playerCount(match) >= match.format.perTeam * 2;

module.exports = {
  createMatch,
  findTeam, isInWaitlist, isInMatch, teamIsFull, playerCount, matchIsFull,
  removePlayer, addToTeam, addToWaitlist,
  fetchMatchChannel, refreshMatchMessage, renderMatchPanel, cancelRefresh, announce,
  findMatchByMessage, findActiveMatchInChannel, findMatchesForPlayer,
};
