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
async function queueAndPlay(kazagumo, { voiceChannel, textChannel, member, query, engine }) {
  const result = await kazagumo.search(query, { requester: member, engine });
  if (!result || !result.tracks.length) return null;

  const player = await getOrCreatePlayer(kazagumo, {
    guildId: voiceChannel.guild.id,
    voiceChannel,
    textChannel,
  });

  const alreadyPlaying = Boolean(player.playing || player.paused || player.queue.current);

  if (result.type === "PLAYLIST") player.queue.add(result.tracks);
  else player.queue.add(result.tracks[0]);

  if (!player.playing && !player.paused) player.play();

  return { result, alreadyPlaying };
}

module.exports = { getOrCreatePlayer, queueAndPlay };
