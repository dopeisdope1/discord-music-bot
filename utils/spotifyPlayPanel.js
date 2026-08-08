const { EmbedBuilder, StringSelectMenuBuilder, ActionRowBuilder } = require("discord.js");
const { formatTrackDuration, trackArtists } = require("./spotifySearch");

/**
 * Construit le panel (embed + menu déroulant) listant les titres Spotify parmi
 * lesquels choisir.
 * @param {"artist"|"track"} mode
 * @param {string} query
 * @param {{ artist?: object, tracks: object[] }} data
 */
function buildTrackChoicePanel(mode, query, { artist, tracks }) {
  const embed = new EmbedBuilder()
    .setTitle(mode === "artist" ? `Titres de ${artist.name}` : `Résultats pour "${query}"`)
    .setDescription(
      tracks
        .map(
          (t, i) => `**${i + 1}.** ${t.name} — ${trackArtists(t)} \`${formatTrackDuration(t.duration_ms)}\``
        )
        .join("\n")
    )
    .setFooter({ text: "Choisis une musique dans le menu ci-dessous" });

  const thumbnail = mode === "artist" ? artist.images?.[0]?.url : tracks[0]?.album?.images?.[0]?.url;
  if (thumbnail) embed.setThumbnail(thumbnail);

  const menu = new StringSelectMenuBuilder()
    .setCustomId("spotify_track_select")
    .setPlaceholder("Choisis une musique...")
    .addOptions(
      tracks.slice(0, 25).map((t, i) => ({
        label: `${i + 1}. ${t.name}`.slice(0, 100),
        description: `${trackArtists(t)} • ${t.album.name}`.slice(0, 100),
        value: t.id,
      }))
    );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

module.exports = { buildTrackChoicePanel };
