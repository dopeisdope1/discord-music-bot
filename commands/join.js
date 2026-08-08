const { SlashCommandBuilder } = require("discord.js");
const { buildStatusEmbed } = require("../utils/statusEmbed");
const { handleJoinSpotify } = require("../utils/joinSpotify");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("join")
    .setDescription("Rejoint et joue ce que tu écoutes actuellement sur Spotify"),

  async execute(interaction) {
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
      return interaction.reply({
        embeds: [buildStatusEmbed("error", "Tu dois être dans un salon vocal.")],
        ephemeral: true,
      });
    }

    await interaction.deferReply();
    await handleJoinSpotify({
      kazagumo: interaction.client.kazagumo,
      voiceChannel,
      textChannel: interaction.channel,
      listenerMember: interaction.member,
      playerMember: interaction.member,
      send: (payload) => interaction.editReply(payload),
    });
  },
};
