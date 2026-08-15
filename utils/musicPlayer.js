const { buildNowPlayingPanel } = require("./nowPlayingPanel");
const { startTracking, setPaused, getElapsedMs, stopTracking } = require("./playbackTimer");
const { setPlayerOwner } = require("./playerControl");

// Discord limite l'édition d'un message à ~5 requêtes / 5s par salon. 5s est
// donc la cadence la plus rapide possible sans risquer des 429 (voire un
// signalement pour abus) sur un salon un peu actif ; impossible de faire du
// vrai "temps réel" seconde par seconde via des éditions de message.
const NOW_PLAYING_REFRESH_MS = 5_000;

/**
 * Récupère le player Kazagumo existant pour un serveur, ou en crée un.
 */
async function getOrCreatePlayer(kazagumo, { guildId, voiceChannel, textChannel }) {
  let player = kazagumo.players.get(guildId);
  if (!player) {
    player = await kazagumo.createPlayer({
      guildId,
      textId: textChannel.id,
      voiceId: voiceChannel.id,
      volume: 100,
      deaf: true,
    });
  }
  return player;
}

/**
 * Recherche `query` via Lavalink (URL ou texte, décidé automatiquement par
 * Kazagumo) et l'ajoute à la file d'attente du serveur, en démarrant la
 * lecture si rien n'est en cours.
 * @returns {null|{ result: object, alreadyPlaying: boolean }}
 */
async function queueAndPlay(kazagumo, { voiceChannel, textChannel, member, query, engine, client }) {
  const result = await kazagumo.search(query, { requester: member, engine });
  if (!result || !result.tracks.length) return null;

  const player = await getOrCreatePlayer(kazagumo, {
    guildId: voiceChannel.guild.id,
    voiceChannel,
    textChannel,
  });

  if (client) setPlayerOwner(client, voiceChannel.guild.id, member.id);

  const alreadyPlaying = Boolean(player.playing || player.paused || player.queue.current);

  if (result.type === "PLAYLIST") player.queue.add(result.tracks);
  else player.queue.add(result.tracks[0]);

  if (!player.playing && !player.paused) player.play();

  return { result, alreadyPlaying };
}

/**
 * Démarre le rafraîchissement périodique du panel "En cours de lecture"
 * (position de lecture en direct). Doit être appelé une fois par nouveau
 * morceau (typiquement dans le handler "playerStart").
 */
function startNowPlayingTracking(client, player, initialElapsedMs = 0) {
  // Ne nettoie que l'ancien intervalle (évite d'en empiler un second) : ne
  // PAS appeler stopNowPlayingTracking ici, qui supprime aussi le message
  // "en cours" tout juste envoyé pour CE morceau et le suivi Spotify actif
  // (voir utils/joinSpotify.js) — les deux doivent survivre à un changement
  // de morceau, c'était le bug qui coupait le suivi `?join` dès le premier
  // morceau, avant même que la personne suivie ne change de musique.
  const previousIntervalId = client.nowPlayingIntervals.get(player.guildId);
  if (previousIntervalId) clearInterval(previousIntervalId);
  startTracking(player.guildId, initialElapsedMs);

  const intervalId = setInterval(() => {
    const message = client.nowPlayingMessages.get(player.guildId);
    const current = client.kazagumo.players.get(player.guildId);
    if (!message || !current || !current.queue.current) return;
    message.edit(buildNowPlayingPanel(current, getElapsedMs(player.guildId))).catch(() => {});
  }, NOW_PLAYING_REFRESH_MS);

  client.nowPlayingIntervals.set(player.guildId, intervalId);
}

/**
 * Arrête le rafraîchissement et nettoie tout l'état associé au panel
 * "En cours de lecture" d'un serveur (à appeler à chaque fois qu'on détruit
 * le player : stop, déconnexion, file terminée...).
 */
function stopNowPlayingTracking(client, guildId) {
  const intervalId = client.nowPlayingIntervals.get(guildId);
  if (intervalId) clearInterval(intervalId);
  client.nowPlayingIntervals.delete(guildId);
  client.nowPlayingMessages.delete(guildId);
  client.spotifyFollows?.delete(guildId);
  stopTracking(guildId);
}

/**
 * Met en pause/reprend un player en gardant le suivi de position à jour.
 */
function setPlayerPaused(player, paused) {
  player.pause(paused);
  setPaused(player.guildId, paused);
}

module.exports = {
  getOrCreatePlayer,
  queueAndPlay,
  startNowPlayingTracking,
  stopNowPlayingTracking,
  setPlayerPaused,
  getElapsedMs,
};
