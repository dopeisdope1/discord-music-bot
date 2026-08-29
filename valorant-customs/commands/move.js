/**
 * /move — force le déplacement d'un joueur dans le salon vocal de son équipe.
 * Utile quand quelqu'un rejoint le mauvais salon ou arrive en retard.
 */

const { SlashCommandBuilder, MessageFlags, InteractionContextType } = require("discord.js");

const store = require("../utils/store");
const { canManage } = require("../utils/permissions");
const { errorEmbed, successEmbed } = require("../utils/embeds");
const { findTeam, findActiveMatchInChannel, findMatchesForPlayer } = require("../utils/matches");
const { moveToTeamChannel } = require("../utils/voice");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("move")
    .setDescription("Déplace un joueur dans le salon vocal de son équipe")
    .setContexts(InteractionContextType.Guild)
    .addUserOption((option) =>
      option
        .setName("joueur")
        .setDescription("Le joueur à déplacer")
        .setRequired(true))
    .addIntegerOption((option) =>
      option
        .setName("equipe")
        .setDescription("Forcer une équipe précise (par défaut : celle du joueur)")
        .addChoices({ name: "🔴 Équipe 1", value: 1 }, { name: "🔵 Équipe 2", value: 2 }))
    .addStringOption((option) =>
      option
        .setName("partie")
        .setDescription("ID de la partie (pied de l'embed) si plusieurs parties tournent")),

  async execute(interaction) {
    const target = interaction.options.getUser("joueur");
    const forcedTeam = interaction.options.getInteger("equipe");
    const matchId = interaction.options.getString("partie");

    const fail = (message) => interaction.reply({ embeds: [errorEmbed(message)], flags: MessageFlags.Ephemeral });

    let match = matchId ? store.getMatch(matchId.replace("#", "").trim()) : findActiveMatchInChannel(interaction.channelId);
    if (!match && !matchId) {
      const candidates = findMatchesForPlayer(interaction.guildId, target.id);
      if (candidates.length === 1) [match] = candidates;
    }
    if (!match) return fail("Aucune partie trouvée. Précise son ID avec l'option `partie`.");
    if (!canManage(match, interaction.member)) {
      return fail("Seul l'hôte de la partie (ou un membre du staff) peut déplacer un joueur.");
    }

    const teamNo = forcedTeam || findTeam(match, target.id);
    if (!teamNo) return fail(`<@${target.id}> n'est dans aucune équipe de cette partie.`);
    if (!match.voice?.[teamNo]) {
      return fail("Les salons vocaux n'existent pas encore : lance d'abord la partie avec le bouton **Lancer la partie**.");
    }

    const result = await moveToTeamChannel(interaction.guild, match, teamNo, target.id);
    if (!result.moved) return fail(result.reason);

    return interaction.reply({
      embeds: [successEmbed(`<@${target.id}> a été déplacé dans <#${match.voice[teamNo]}>.`)],
      flags: MessageFlags.Ephemeral,
    });
  },
};
