const { SlashCommandBuilder } = require("discord.js");
const { buildStatusEmbed } = require("../utils/statusEmbed");
const { handleJoinSpotify } = require("../utils/joinSpotify");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("join")
    .setDescription("Rejoint et joue ce que tu (ou un autre membre) écoutes actuellement sur Spotify")
    .addUserOption((option) =>
      option.setName("membre").setDescription("Le membre à suivre (toi par défaut)").setRequired(false)
    ),

  async execute(interaction) {
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) {
      return interaction.reply({
        embeds: [buildStatusEmbed("error", "Tu dois être dans un salon vocal.")],
        ephemeral: true,
      });
    }

    const targetUser = interaction.options.getUser("membre");
    const listenerMember = targetUser
      ? interaction.guild.members.cache.get(targetUser.id)
      : interaction.member;
    if (!listenerMember) {
      return interaction.reply({
        embeds: [buildStatusEmbed("error", "Membre introuvable.")],
        ephemeral: true,
      });
    }

    await interaction.deferReply();
    await handleJoinSpotify({
      client: interaction.client,
      voiceChannel,
      textChannel: interaction.channel,
      listenerMember,
      playerMember: interaction.member,
      send: (payload) => interaction.editReply(payload),
    });
  },
};
