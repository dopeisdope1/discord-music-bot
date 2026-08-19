const { SlashCommandBuilder, MessageFlags } = require("discord.js");
const { buildStatusEmbed } = require("../utils/statusEmbed");
const { handleSpotifyPlay } = require("../utils/spotifyPlay");
const { queueAndPlay } = require("../utils/musicPlayer");
const { playbackErrorMessage } = require("../utils/musicErrors");
const { buildFavoritesPanel } = require("../utils/favoritesPanel");

const URL_REGEX = /^https?:\/\//i;

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Joue une musique (recherche par nom/artiste, ou lien YouTube/Spotify)")
    .addStringOption((option) =>
      option
        .setName("recherche")
        .setDescription("Nom de musique/artiste, ou lien YouTube/Spotify (laisse vide pour tes favoris)")
        .setRequired(false)
    ),

  async execute(interaction) {
    const query = interaction.options.getString("recherche");
    const voiceChannel = interaction.member.voice.channel;

    // Sans recherche : la playlist des favoris, comme pour `play` en préfixe.
    if (!query) {
      const panel = buildFavoritesPanel(interaction.user.id, "/");
      // flags et ephemeral ne peuvent pas coexister : le panel porte déjà
      // IsComponentsV2, on y ajoute donc Ephemeral plutôt que l'option.
      if (panel) return interaction.reply({ ...panel, flags: panel.flags | MessageFlags.Ephemeral });
      return interaction.reply({
        embeds: [
          buildStatusEmbed(
            "error",
            "Tu n'as encore aucun favori — ajoute-en avec le bouton **Favori** du panel de lecture."
          ),
        ],
        ephemeral: true,
      });
    }

    if (!voiceChannel) {
      return interaction.reply({
        embeds: [buildStatusEmbed("error", "Tu dois être dans un salon vocal pour lancer une musique.")],
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    if (URL_REGEX.test(query)) {
      try {
        const outcome = await queueAndPlay(interaction.client.kazagumo, {
          voiceChannel,
          textChannel: interaction.channel,
          member: interaction.member,
          query,
          client: interaction.client,
        });
        if (!outcome) {
          return interaction.editReply({
            embeds: [buildStatusEmbed("error", "Impossible de jouer ce titre. Vérifie le lien.")],
          });
        }
        const label = outcome.alreadyPlaying ? "Ajouté à la file d'attente" : "Lancement de";
        await interaction.editReply({
          embeds: [buildStatusEmbed("info", `${label} : **${outcome.result.tracks[0].title}**`)],
        });
      } catch (err) {
        console.error(err);
        await interaction.editReply({
          embeds: [buildStatusEmbed("error", playbackErrorMessage(err, "Impossible de jouer ce titre. Vérifie le lien."))],
        });
      }
      return;
    }

    await handleSpotifyPlay({
      kazagumo: interaction.client.kazagumo,
      client: interaction.client,
      voiceChannel,
      textChannel: interaction.channel,
      member: interaction.member,
      query,
      requesterId: interaction.user.id,
      send: (payload) => interaction.editReply(payload),
    });
  },
};
