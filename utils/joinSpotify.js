const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getSpotifyActivity, spotifyActivityQuery, spotifyActivityElapsedMs } = require("./spotifyPresence");
const { getOrCreatePlayer } = require("./musicPlayer");
const { buildStatusEmbed } = require("./statusEmbed");

/**
 * Rejoint un salon vocal et joue ce que `listenerMember` écoute actuellement
 * sur Spotify, à la même position, puis suit ses changements de morceau en
 * direct (voir le listener "presenceUpdate" dans index.js) jusqu'à ce que le
 * player soit détruit.
 *
 * Utilisé à la fois par `!join` (listenerMember === playerMember) et
 * par le bouton "Écouter avec lui" posté en réponse (listenerMember = la
 * personne suivie, playerMember = la personne qui clique et dont on rejoint
 * le salon vocal).
 * @param {object} params
 * @param {import('discord.js').Client} params.client
 * @param {import('discord.js').VoiceBasedChannel} params.voiceChannel
 * @param {import('discord.js').TextBasedChannel} params.textChannel
 * @param {import('discord.js').GuildMember} params.listenerMember
 * @param {import('discord.js').GuildMember} params.playerMember
 * @param {(payload: object) => Promise<unknown>} params.send
 */
async function handleJoinSpotify({ client, voiceChannel, textChannel, listenerMember, playerMember, send }) {
  const activity = getSpotifyActivity(listenerMember);
  if (!activity) {
    const who = listenerMember.id === playerMember.id ? "Tu n'écoutes" : `${listenerMember.displayName} n'écoute`;
    await send({ embeds: [buildStatusEmbed("error", `${who} rien sur Spotify actuellement.`)] });
    return;
  }

  const result = await client.kazagumo.search(spotifyActivityQuery(activity), {
    requester: playerMember,
    engine: "youtube",
  });
  if (!result || !result.tracks.length) {
    await send({ embeds: [buildStatusEmbed("error", `Impossible de trouver **${activity.details}** sur YouTube.`)] });
    return;
  }

  const player = await getOrCreatePlayer(client.kazagumo, {
    guildId: voiceChannel.guild.id,
    voiceChannel,
    textChannel,
  });

  // Enregistre le suivi AVANT de lancer la lecture : le handler "playerStart"
  // s'en sert pour afficher la bonne position dans le panel.
  client.spotifyFollows.set(voiceChannel.guild.id, {
    targetUserId: listenerMember.id,
    lastSyncId: activity.syncId,
  });

  // Position envoyée directement dans l'appel de lecture (recalculée juste
  // avant, au cas où la recherche ci-dessus ait pris du temps) : Lavalink
  // démarre la piste déjà à la bonne seconde en un seul aller-retour réseau,
  // sans passer par un seek() séparé après coup.
  const freshActivity = getSpotifyActivity(listenerMember) ?? activity;
  await player.play(result.tracks[0], {
    replaceCurrent: true,
    position: spotifyActivityElapsedMs(freshActivity),
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`spotify_join:${listenerMember.id}`)
      .setLabel("Écouter avec lui")
      .setStyle(ButtonStyle.Secondary)
  );

  await send({
    embeds: [
      buildStatusEmbed(
        "info",
        `${listenerMember.displayName} écoute **${activity.details}**${
          activity.state ? ` — ${activity.state}` : ""
        } sur Spotify.\n\`!join\` pour rejoindre, ou clique sur le bouton pour écouter avec lui. La lecture suit automatiquement ses changements de musique.`
      ),
    ],
    components: [row],
  });
}

module.exports = { handleJoinSpotify };
