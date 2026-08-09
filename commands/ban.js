const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { buildStatusEmbed } = require("../utils/statusEmbed");
const { hasBanPermission } = require("../utils/permissions");
const { randomClearJoke } = require("../utils/jokes");
const { sendLog } = require("../utils/actionLogger");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Bannit un membre du serveur (Zinki Assassini, recherche en direct)")
    .addStringOption((option) =>
      option
        .setName("membre")
        .setDescription("Tape un pseudo ou un ID")
        .setRequired(true)
        .setAutocomplete(true)
    ),

  /**
   * Suggestions en direct pendant que l'utilisateur tape : aucune liste tant
   * que le champ est vide, uniquement des membres qui correspondent (via
   * l'API de recherche de membres Discord) — la seule manière d'avoir un
   * vrai "zéro résultat avant de taper" côté Discord (impossible avec un
   * menu déroulant User/StringSelectMenu classique, qui affiche toujours une
   * liste par défaut).
   */
  async autocomplete(interaction) {
    const focused = interaction.options.getFocused().trim();
    if (!focused) return interaction.respond([]);

    const results = await interaction.guild.members.search({ query: focused, limit: 20 }).catch(() => null);
    if (!results) return interaction.respond([]);

    const choices = [...results.values()]
      .filter((m) => m.id !== interaction.user.id && m.id !== interaction.client.user.id)
      .slice(0, 25)
      .map((m) => ({ name: m.user.tag.slice(0, 100), value: m.id }));

    await interaction.respond(choices);
  },

  async execute(interaction) {
    if (!hasBanPermission(interaction)) {
      return interaction.reply({
        embeds: [
          buildStatusEmbed(
            "error",
            "Tu dois être administrateur ou avoir la permission **Bannir des membres** pour utiliser cette commande."
          ),
        ],
        ephemeral: true,
      });
    }
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
      return interaction.reply({ embeds: [buildStatusEmbed("error", "Il me manque la permission **Bannir des membres**.")] });
    }

    const targetId = interaction.options.getString("membre");
    if (targetId === interaction.user.id) {
      return interaction.reply({ embeds: [buildStatusEmbed("error", "Tu ne peux pas te bannir toi-même.")], ephemeral: true });
    }
    if (targetId === interaction.client.user.id) {
      return interaction.reply({ embeds: [buildStatusEmbed("error", "Je ne vais pas me bannir moi-même.")], ephemeral: true });
    }

    await interaction.deferReply();

    const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (targetMember && !targetMember.bannable) {
      return interaction.editReply({
        embeds: [buildStatusEmbed("error", "Je ne peux pas bannir ce membre (rôle trop élevé ou permissions insuffisantes).")],
      });
    }

    const banResult = await interaction.guild.members
      .ban(targetId, { reason: `Zinki Assassini — banni par ${interaction.user.tag}` })
      .catch((err) => {
        console.error(err);
        return null;
      });

    if (!banResult) {
      return interaction.editReply({
        embeds: [
          buildStatusEmbed(
            "error",
            `Impossible de bannir ${targetMember ? targetMember.user.tag : `<@${targetId}>`} (erreur Discord — voir les logs).`
          ),
        ],
      });
    }

    await interaction.editReply({
      embeds: [buildStatusEmbed("success", `${targetMember ? targetMember.user.tag : `<@${targetId}>`} a été banni — ${randomClearJoke()}`)],
    });
    sendLog(interaction.client, interaction.guild.id, "moderation", {
      title: "Ban",
      description: "Membre banni via /ban (Zinki Assassini).",
      actor: interaction.user,
      fields: [
        { name: "Cible", value: targetMember ? `${targetMember.user.tag} (${targetId})` : `<@${targetId}>`, inline: true },
      ],
    });
  },
};
