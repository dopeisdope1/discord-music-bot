/**
 * /avertir — déclenche le compte à rebours anti-absent sur un joueur.
 * Réservé à l'hôte de la partie et au staff (vérifié dans runWarning).
 */

const { SlashCommandBuilder, MessageFlags, InteractionContextType } = require("discord.js");

const store = require("../utils/store");
const { errorEmbed } = require("../utils/embeds");
const { findActiveMatchInChannel, findMatchesForPlayer } = require("../utils/matches");
const { runWarning } = require("../utils/matchActions");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("avertir")
    .setDescription("Avertit un joueur absent : 1 minute pour rejoindre le vocal, sinon il perd sa place")
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option
        .setName("joueur")
        .setDescription("Le joueur à avertir")
        .setRequired(true))
    .addStringOption((option) =>
      option
        .setName("partie")
        .setDescription("ID de la partie (visible dans le pied de l'embed) — utile si plusieurs parties tournent")),

  async execute(interaction) {
    const target = interaction.options.getUser("joueur");
    const matchId = interaction.options.getString("partie");

    const fail = (message) => interaction.reply({ embeds: [errorEmbed(message)], flags: MessageFlags.Ephemeral });

    if (target.bot) return fail("On n'avertit pas un bot.");

    // Résolution de la partie : ID explicite > partie du salon > partie où le
    // joueur est inscrit (si une seule).
    let match = null;
    if (matchId) {
      match = store.getMatch(matchId.replace("#", "").trim());
      if (!match) return fail(`Aucune partie ne porte l'ID \`${matchId}\`.`);
    } else {
      match = findActiveMatchInChannel(interaction.channelId);
      if (!match) {
        const candidates = findMatchesForPlayer(interaction.guildId, target.id);
        if (candidates.length === 1) [match] = candidates;
        else if (candidates.length > 1) {
          const list = candidates.map((entry) => `\`#${entry.id}\` (${entry.format.label})`).join(", ");
          return fail(`Ce joueur participe à plusieurs parties : précise laquelle avec l'option \`partie\` — ${list}.`);
        }
      }
    }

    if (!match) return fail("Aucune partie en cours dans ce salon. Lance-en une avec `/custom`.");
    if (match.status === "ended") return fail("Cette partie est terminée.");

    return runWarning(interaction, match, target.id);
  },
};
