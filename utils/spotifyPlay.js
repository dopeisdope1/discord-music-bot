const { resolveSpotifyQuery, trackArtists } = require("./spotifySearch");
const { buildTrackChoicePanel } = require("./spotifyPlayPanel");
const { buildStatusEmbed } = require("./statusEmbed");

const SELECTION_TIMEOUT_MS = 30_000;

/**
 * Résout une recherche `!play <texte>` / `/play <texte>` via Spotify (sans lien)
 * et lance la lecture — directement si un seul titre correspond, sinon via un
 * menu déroulant pour laisser l'utilisateur choisir.
 * @param {object} params
 * @param {import('distube').DisTube} params.distube
 * @param {import('discord.js').VoiceBasedChannel} params.voiceChannel
 * @param {import('discord.js').TextBasedChannel} params.textChannel
 * @param {import('discord.js').GuildMember} params.member
 * @param {string} params.query
 * @param {string} params.requesterId
 * @param {(payload: object) => Promise<import('discord.js').Message>} params.send
 *   Envoie le message initial et renvoie l'objet Message créé.
 */
async function handleSpotifyPlay({ distube, voiceChannel, textChannel, member, query, requesterId, send }) {
  let resolved;
  try {
    resolved = await resolveSpotifyQuery(query);
  } catch (err) {
    console.error(err);
    await send({ embeds: [buildStatusEmbed("error", "Impossible de contacter Spotify pour cette recherche.")] });
    return;
  }

  const { mode, tracks, artist } = resolved;

  if (!tracks || tracks.length === 0) {
    await send({ embeds: [buildStatusEmbed("error", `Aucun résultat Spotify pour **${query}**.`)] });
    return;
  }

  const playTrack = async (track) => {
    try {
      await distube.play(voiceChannel, track.external_urls.spotify, { textChannel, member });
    } catch (err) {
      console.error(err);
      await textChannel.send({
        embeds: [buildStatusEmbed("error", `Impossible de jouer **${track.name}**.`)],
      });
    }
  };

  if (tracks.length === 1) {
    await send({
      embeds: [
        buildStatusEmbed("info", `Lancement de **${tracks[0].name}** — ${trackArtists(tracks[0])}`, {
          icon: "🟢",
        }),
      ],
    });
    await playTrack(tracks[0]);
    return;
  }

  const choiceMessage = await send(buildTrackChoicePanel(mode, query, { artist, tracks }));

  const collector = choiceMessage.createMessageComponentCollector({
    time: SELECTION_TIMEOUT_MS,
    max: 1,
  });

  collector.on("collect", async (i) => {
    if (i.user.id !== requesterId) {
      await i.reply({
        embeds: [buildStatusEmbed("error", "Seule la personne qui a lancé la recherche peut choisir.")],
        ephemeral: true,
      });
      return;
    }
    const chosen = tracks.find((t) => t.id === i.values[0]);
    await i.update({
      embeds: [buildStatusEmbed("info", `Lancement de **${chosen.name}** — ${trackArtists(chosen)}`, { icon: "🟢" })],
      components: [],
    });
    await playTrack(chosen);
  });

  collector.on("end", (collected) => {
    if (collected.size === 0) {
      choiceMessage
        .edit({ embeds: [buildStatusEmbed("warning", "Sélection expirée.", { icon: "⏱️" })], components: [] })
        .catch(() => {});
    }
  });
}

module.exports = { handleSpotifyPlay };
