/**
 * `avertir` — déclenche le compte à rebours anti-absent sur un joueur.
 *
 *   +avertir @joueur
 *   +avertir 123456789012345678
 *   +avertir @joueur #a1b2c3        (si plusieurs parties tournent)
 *
 * Réservé à l'hôte de la partie, au staff du serveur et aux gestionnaires.
 */

const store = require("../utils/store");
const settings = require("../utils/settings");
const { canManage } = require("../utils/permissions");
const { findActiveMatchInChannel, findMatchesForPlayer } = require("../utils/matches");
const { startWarning } = require("../utils/warnings");
const { replyError, replyOk } = require("../utils/reply");

/** Récupère la cible : mention, ou ID brut collé dans les arguments. */
function resolveTargetId(message, args) {
  const mentioned = message.mentions.users.first();
  if (mentioned) return mentioned.id;
  const raw = args.find((arg) => /^\d{17,20}$/.test(arg.replace(/[<@!>]/g, "")));
  return raw ? raw.replace(/[<@!>]/g, "") : null;
}

module.exports = {
  name: "avertir",
  aliases: ["warn", "afk"],
  description: "Avertit un joueur absent : il perd sa place s'il ne rejoint pas le vocal à temps",
  usage: "avertir @joueur [#idPartie]",

  async execute(message, args) {
    const prefix = settings.get("prefix");
    const targetId = resolveTargetId(message, args);
    if (!targetId) return replyError(message, `Mentionne le joueur à avertir : \`${prefix}avertir @joueur\`.`);
    if (targetId === message.client.user.id) return replyError(message, "On n'avertit pas le bot.");

    // Résolution de la partie : ID explicite > partie du salon > partie où le
    // joueur est inscrit (si une seule).
    const explicitId = args.find((arg) => arg.startsWith("#"))?.slice(1);
    let match = explicitId ? store.getMatch(explicitId) : findActiveMatchInChannel(message.channelId);
    if (explicitId && !match) return replyError(message, `Aucune partie ne porte l'ID \`${explicitId}\`.`);

    if (!match) {
      const candidates = findMatchesForPlayer(message.guildId, targetId);
      if (candidates.length === 1) [match] = candidates;
      else if (candidates.length > 1) {
        const list = candidates.map((entry) => `\`#${entry.id}\``).join(", ");
        return replyError(message, `Ce joueur participe à plusieurs parties : précise laquelle — ${list}.`);
      }
    }

    if (!match) return replyError(message, `Aucune partie en cours dans ce salon. Lance-en une avec \`${prefix}custom\`.`);
    if (match.status === "ended") return replyError(message, "Cette partie est terminée.");
    if (!canManage(match, message.member)) {
      return replyError(message, "Seul l'hôte de la partie (ou un responsable) peut avertir un joueur.");
    }

    const result = await startWarning(message.client, match, targetId, message.author.id);
    if (!result.ok) return replyError(message, result.error);

    const seconds = settings.warnSeconds();
    return replyOk(
      message,
      `<@${targetId}> a été averti (**Équipe ${result.teamNo}**). Retrait automatique dans **${seconds} s** s'il ne rejoint pas le vocal.`,
    );
  },
};
