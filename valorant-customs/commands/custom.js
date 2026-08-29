/**
 * /custom — crée une partie personnalisée et poste son embed interactif.
 */

const { SlashCommandBuilder, MessageFlags, InteractionContextType } = require("discord.js");

const config = require("../config");
const store = require("../utils/store");
const access = require("../utils/access");
const settings = require("../utils/settings");
const { logEvent } = require("../utils/logger");
const { rankChoices, formatRank } = require("../utils/ranks");
const { createMatch, addToTeam } = require("../utils/matches");
const { buildMatchEmbed, buildMatchComponents, errorEmbed } = require("../utils/embeds");

const RANDOM_MAP = "__random__";

module.exports = {
  data: new SlashCommandBuilder()
    .setName("custom")
    .setDescription("Crée une partie personnalisée Valorant")
    .setContexts(InteractionContextType.Guild)
    .addStringOption((option) =>
      option
        .setName("format")
        .setDescription("Format de la partie (5v5 par défaut)")
        .addChoices(...config.formats.map((format) => ({ name: format.label, value: format.key }))))
    .addStringOption((option) =>
      option
        .setName("map")
        .setDescription("Map jouée (optionnel)")
        .addChoices(
          { name: "🎲 Aléatoire", value: RANDOM_MAP },
          ...config.maps.map((map) => ({ name: map, value: map })),
        ))
    .addStringOption((option) =>
      option
        .setName("rang_minimum")
        .setDescription("Rang minimum exigé pour rejoindre (optionnel)")
        .addChoices(...rankChoices({ includeUnranked: false })))
    .addBooleanOption((option) =>
      option
        .setName("rejoindre")
        .setDescription("T'inscrire directement en Équipe 1 (activé par défaut)")),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        embeds: [errorEmbed("Cette commande ne fonctionne que sur un serveur.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    // Verrou activable depuis le panneau : création réservée aux autorisés.
    if (settings.get("restrictCreation") && !access.isManager(interaction.user.id)) {
      return interaction.reply({
        embeds: [errorEmbed("La création de parties est réservée aux membres autorisés par le propriétaire du bot.")],
        flags: MessageFlags.Ephemeral,
      });
    }

    const formatKey = interaction.options.getString("format") || "5v5";
    const format = config.formats.find((entry) => entry.key === formatKey) || config.formats[0];

    let map = interaction.options.getString("map");
    if (map === RANDOM_MAP) map = config.maps[Math.floor(Math.random() * config.maps.length)];

    const minRank = interaction.options.getString("rang_minimum");
    const autoJoin = interaction.options.getBoolean("rejoindre") ?? true;

    const match = createMatch({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      hostId: interaction.user.id,
      format,
      map,
      minRank,
    });

    // L'hôte s'inscrit d'office s'il joue ET s'il a déjà un profil : sans
    // profil, on ne peut pas afficher son pseudo/rang dans l'embed.
    const profile = store.getProfile(interaction.user.id);
    if (autoJoin && profile) addToTeam(match, interaction.user.id, 1);

    // Enregistrée AVANT l'envoi : si quelqu'un clique sur un bouton dans la
    // milliseconde qui suit, la partie est déjà connue du bot.
    store.putMatch(match);

    await interaction.reply({
      embeds: [buildMatchEmbed(match)],
      components: buildMatchComponents(match),
      allowedMentions: { parse: [] },
    });

    // On mémorise le message pour pouvoir le rafraîchir à chaque changement.
    const message = await interaction.fetchReply();
    match.messageId = message.id;
    store.save();

    logEvent(interaction.client, "create", {
      matchId: match.id,
      description: `Partie ${format.label} créée par <@${interaction.user.id}>${map ? ` sur **${map}**` : ""}.`,
    });

    // Petit rappel éphémère si le profil manque : l'hôte n'a pas été inscrit.
    if (autoJoin && !profile) {
      await interaction.followUp({
        embeds: [
          errorEmbed(
            "Tu n'as pas encore de profil Valorant : tu n'as donc pas été inscrit automatiquement.\n" +
            "Clique sur **Rejoindre Équipe 1** (une fenêtre s'ouvrira) ou utilise `/profil`.",
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    } else if (autoJoin && profile) {
      await interaction.followUp({
        embeds: [
          {
            color: config.colors.success,
            description: `✅ Tu es inscrit en **Équipe 1** avec \`${profile.riotId}\` · ${formatRank(profile.rank)}.`,
          },
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
  },
};
