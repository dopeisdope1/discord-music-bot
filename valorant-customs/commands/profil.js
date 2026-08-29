/**
 * /profil — consulte ou met à jour son profil Valorant (pseudo + rang).
 * Ces informations alimentent l'affichage des équipes dans l'embed de partie.
 */

const { SlashCommandBuilder, MessageFlags, InteractionContextType } = require("discord.js");

const config = require("../config");
const store = require("../utils/store");
const { rankChoices, formatRank, RANK_BY_KEY } = require("../utils/ranks");
const { errorEmbed, successEmbed, infoEmbed } = require("../utils/embeds");
const { findMatchesForPlayer, refreshMatchMessage } = require("../utils/matches");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("profil")
    .setDescription("Affiche ou met à jour ton profil Valorant (pseudo + rang)")
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName("pseudo")
        .setDescription("Ton Riot ID complet, ex. TenZ#0505")
        .setMaxLength(40))
    .addStringOption((option) =>
      option
        .setName("rang")
        .setDescription("Ton rang actuel")
        .addChoices(...rankChoices()))
    .addIntegerOption((option) =>
      option
        .setName("division")
        .setDescription("Division dans le rang (1, 2 ou 3)")
        .addChoices({ name: "1", value: 1 }, { name: "2", value: 2 }, { name: "3", value: 3 }))
    .addUserOption((option) =>
      option
        .setName("joueur")
        .setDescription("Consulter le profil d'un autre joueur")),

  async execute(interaction) {
    const other = interaction.options.getUser("joueur");
    const pseudo = interaction.options.getString("pseudo");
    const rangKey = interaction.options.getString("rang");
    const division = interaction.options.getInteger("division");

    // ---- Consultation ----
    if (other || (!pseudo && !rangKey && !division)) {
      const targetId = other?.id || interaction.user.id;
      const profile = store.getProfile(targetId);
      if (!profile) {
        return interaction.reply({
          embeds: [errorEmbed(
            other
              ? `<@${targetId}> n'a pas encore renseigné de profil Valorant.`
              : "Tu n'as pas encore de profil. Renseigne-le avec `/profil pseudo:TonPseudo#TAG rang:...`.",
          )],
          flags: MessageFlags.Ephemeral,
        });
      }

      return interaction.reply({
        embeds: [infoEmbed([
          `👤 **Profil de <@${targetId}>**`,
          config.separator,
          `**Riot ID** · \`${profile.riotId}\``,
          `**Rang** · ${formatRank(profile.rank)}`,
          `**Mis à jour** · <t:${Math.floor(profile.updatedAt / 1000)}:R>`,
        ].join("\n"))],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ---- Mise à jour ----
    const existing = store.getProfile(interaction.user.id);
    if (!pseudo && !existing) {
      return interaction.reply({
        embeds: [errorEmbed("Renseigne aussi ton `pseudo` (Riot ID) pour créer ton profil.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    const rank = rangKey
      ? { key: rangKey, division: RANK_BY_KEY.get(rangKey)?.divisions ? division ?? null : null }
      : existing?.rank || { key: "unranked", division: null };

    // Changer uniquement la division sans repréciser le rang reste possible.
    if (!rangKey && division && existing?.rank?.key && RANK_BY_KEY.get(existing.rank.key)?.divisions) {
      rank.division = division;
    }

    const profile = store.setProfile(interaction.user.id, {
      riotId: pseudo?.trim() || existing.riotId,
      rank,
    });

    // Les embeds où le joueur apparaît reflètent immédiatement le changement.
    for (const match of findMatchesForPlayer(interaction.guildId, interaction.user.id)) {
      await refreshMatchMessage(interaction.client, match);
    }

    return interaction.reply({
      embeds: [successEmbed(`Profil mis à jour : \`${profile.riotId}\` · ${formatRank(profile.rank)}`)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
