/**
 * `move` — force le déplacement d'un joueur dans le salon vocal de son équipe.
 *
 *   +move @joueur          → dans le salon de SON équipe
 *   +move @joueur 2        → force l'Équipe 2
 *   +move tous             → rapatrie tout le monde
 */

const store = require("../utils/store");
const settings = require("../utils/settings");
const { canManage } = require("../utils/permissions");
const { findTeam, findActiveMatchInChannel, findMatchesForPlayer } = require("../utils/matches");
const { moveToTeamChannel } = require("../utils/voice");
const { replyError, replyOk } = require("../utils/reply");

const ALL = ["tous", "tout", "all", "everyone"];

module.exports = {
  name: "move",
  aliases: ["deplacer", "vocal"],
  description: "Déplace un joueur (ou tout le monde) dans le bon salon vocal",
  usage: "move @joueur [1|2]  ·  move tous",

  async execute(message, args) {
    const prefix = settings.get("prefix");
    const explicitId = args.find((arg) => arg.startsWith("#"))?.slice(1);
    const match = explicitId ? store.getMatch(explicitId) : findActiveMatchInChannel(message.channelId);

    if (!match) return replyError(message, `Aucune partie en cours dans ce salon. Lance-en une avec \`${prefix}custom\`.`);
    if (!canManage(match, message.member)) {
      return replyError(message, "Seul l'hôte de la partie (ou un responsable) peut déplacer un joueur.");
    }
    if (!match.voice?.[1] && !match.voice?.[2]) {
      return replyError(message, "Les salons vocaux n'existent pas encore : lance d'abord la partie avec **Lancer la partie**.");
    }

    // ---- Rapatriement complet ----
    if (args.some((arg) => ALL.includes(arg.toLowerCase()))) {
      let moved = 0;
      for (const teamNo of [1, 2]) {
        for (const userId of match.teams[teamNo]) {
          const result = await moveToTeamChannel(message.guild, match, teamNo, userId);
          if (result.moved) moved += 1;
        }
      }
      return replyOk(message, `**${moved}** joueur(s) déplacé(s) dans le salon de leur équipe.`);
    }

    // ---- Un joueur ----
    const target = message.mentions.users.first();
    if (!target) return replyError(message, `Mentionne le joueur : \`${prefix}move @joueur\` (ou \`${prefix}move tous\`).`);

    const forced = args.find((arg) => arg === "1" || arg === "2");
    const teamNo = forced ? Number(forced) : findTeam(match, target.id);
    if (!teamNo) return replyError(message, `<@${target.id}> n'est dans aucune équipe de cette partie.`);

    const result = await moveToTeamChannel(message.guild, match, teamNo, target.id);
    if (!result.moved) return replyError(message, result.reason);

    return replyOk(message, `<@${target.id}> a été déplacé dans <#${match.voice[teamNo]}>.`);
  },
};
