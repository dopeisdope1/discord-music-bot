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
 *   teams: { 1: [userId], 2: [userId] },
 *   waitlist: [userId],
 *   voice: { 1: channelId|null, 2: channelId|null },
 *   warnings: { [userId]: { deadline, teamNo, issuerId, noticeId } },
 *   offers: { [teamNo]: { userId, deadline, messageId } }
 * }
 */

const store = require("./store");
const { buildMatchEmbed, buildMatchComponents } = require("./embeds");

function createMatch({ guildId, channelId, hostId, format, map, minRank }) {
  return {
    id: store.newMatchId(),
    guildId,
    channelId,
    messageId: null,
    hostId,
    createdAt: Date.now(),
    format,
    map: map || null,
    minRank: minRank || null,
    status: "waiting",
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

/** Ré-affiche l'embed de la partie à partir de son état courant. */
async function refreshMatchMessage(client, match) {
  if (!match.messageId) return;
  const channel = await fetchMatchChannel(client, match);
  if (!channel) return;
  try {
    const message = await channel.messages.fetch(match.messageId);
    await message.edit({
      embeds: [buildMatchEmbed(match)],
      components: buildMatchComponents(match),
    });
  } catch (error) {
    // Message supprimé à la main : on n'insiste pas, la partie reste utilisable
    // via les commandes slash.
    console.error(`[matches] Rafraîchissement impossible (#${match.id}) :`, error.message);
  }
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

module.exports = {
  createMatch,
  findTeam, isInWaitlist, isInMatch, teamIsFull, playerCount,
  removePlayer, addToTeam, addToWaitlist,
  fetchMatchChannel, refreshMatchMessage, announce,
  findMatchByMessage, findActiveMatchInChannel, findMatchesForPlayer,
};
