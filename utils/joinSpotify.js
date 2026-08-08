const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getSpotifyActivity, spotifyActivityQuery } = require("./spotifyPresence");
const { queueAndPlay } = require("./musicPlayer");
const { buildStatusEmbed } = require("./statusEmbed");

/**
 * Rejoint un salon vocal et joue ce que `listenerMember` écoute actuellement
 * sur Spotify (présence Discord). Utilisé à la fois par `!join`/`/join`
 * (listenerMember === playerMember) et par le bouton "Écouter avec lui"
 * posté en réponse (listenerMember = la personne suivie, playerMember =
 * la personne qui clique et dont on rejoint le salon vocal).
 * @param {object} params
 * @param {import('kazagumo').Kazagumo} params.kazagumo
 * @param {import('discord.js').VoiceBasedChannel} params.voiceChannel
 * @param {import('discord.js').TextBasedChannel} params.textChannel
 * @param {import('discord.js').GuildMember} params.listenerMember
 * @param {import('discord.js').GuildMember} params.playerMember
 * @param {(payload: object) => Promise<unknown>} params.send
 */
async function handleJoinSpotify({ kazagumo, voiceChannel, textChannel, listenerMember, playerMember, send }) {
  const activity = getSpotifyActivity(listenerMember);
  if (!activity) {
    const who = listenerMember.id === playerMember.id ? "Tu n'écoutes" : `${listenerMember.displayName} n'écoute`;
    await send({ embeds: [buildStatusEmbed("error", `${who} rien sur Spotify actuellement.`)] });
    return;
  }

  const outcome = await queueAndPlay(kazagumo, {
    voiceChannel,
    textChannel,
    member: playerMember,
    query: spotifyActivityQuery(activity),
    engine: "youtube",
  });

  if (!outcome) {
    await send({ embeds: [buildStatusEmbed("error", `Impossible de trouver **${activity.details}** sur YouTube.`)] });
    return;
  }

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
        } sur Spotify.\n\`!join\` pour rejoindre, ou clique sur le bouton pour écouter avec lui.`
      ),
    ],
    components: [row],
  });
}

module.exports = { handleJoinSpotify };
