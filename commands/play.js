const { SlashCommandBuilder } = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("play")
    .setDescription("Joue une musique (YouTube, Spotify, SoundCloud...)")
    .addStringOption((option) =>
      option
        .setName("recherche")
        .setDescription("Nom, URL YouTube ou URL Spotify (titre/playlist/album)")
        .setRequired(true)
    ),

  async execute(interaction) {
    const query = interaction.options.getString("recherche");
    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
      return interaction.reply({
        content: "❌ Tu dois être dans un salon vocal pour lancer une musique.",
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    try {
      await interaction.client.distube.play(voiceChannel, query, {
        textChannel: interaction.channel,
        member: interaction.member,
      });
      await interaction.editReply(`🔎 Recherche en cours pour : **${query}**`);
    } catch (err) {
      console.error(err);
      await interaction.editReply("❌ Impossible de jouer ce titre.");
    }
  },
};
