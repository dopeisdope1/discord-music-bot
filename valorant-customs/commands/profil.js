/**
 * `profil` — consulte ou met à jour son profil Valorant (pseudo + rang).
 *
 *   +profil                          → ton profil
 *   +profil @joueur                  → le profil de quelqu'un d'autre
 *   +profil TenZ#0505 Diamant 2      → crée / met à jour le tien
 *   +profil Immortel                 → change seulement le rang
 *   +profil NouveauPseudo#EUW        → change seulement le pseudo
 */

const config = require("../config");
const store = require("../utils/store");
const settings = require("../utils/settings");
const { parseRank, formatRank, RANK_HELP } = require("../utils/ranks");
const { findMatchesForPlayer, refreshMatchMessage } = require("../utils/matches");
const { replyError, replyOk, replyInfo } = require("../utils/reply");

module.exports = {
  name: "profil",
  aliases: ["profile", "pseudo", "rang"],
  description: "Affiche ou met à jour ton profil Valorant",
  usage: "profil [Pseudo#TAG] [rang]  ·  profil @joueur",

  async execute(message, args) {
    const prefix = settings.get("prefix");
    const mentioned = message.mentions.users.first();

    // ---- Consultation ----
    if (mentioned || !args.length) {
      const targetId = mentioned?.id || message.author.id;
      const profile = store.getProfile(targetId);
      if (!profile) {
        return replyError(
          message,
          mentioned
            ? `<@${targetId}> n'a pas encore renseigné de profil Valorant.`
            : `Tu n'as pas encore de profil. Fais \`${prefix}profil TonPseudo#TAG Diamant 2\`.`,
        );
      }

      return replyInfo(message, [
        `👤 **Profil de <@${targetId}>**`,
        config.separator,
        `**Riot ID** · \`${profile.riotId}\``,
        `**Rang** · ${formatRank(profile.rank)}`,
        `**Mis à jour** · <t:${Math.floor(profile.updatedAt / 1000)}:R>`,
      ].join("\n"));
    }

    // ---- Mise à jour ----
    const existing = store.getProfile(message.author.id);
    const riotToken = args.find((arg) => arg.includes("#"));
    const rankText = args.filter((arg) => arg !== riotToken).join(" ").trim();
    const rank = rankText ? parseRank(rankText) : null;

    if (rankText && !rank) {
      return replyError(message, `Rang non reconnu : \`${rankText}\`.\nValeurs acceptées : ${RANK_HELP} — avec une division si tu veux (« Diamant 2 »).`);
    }
    if (!riotToken && !rank) {
      return replyError(message, `Format attendu : \`${prefix}profil TonPseudo#TAG Diamant 2\`.`);
    }
    if (!riotToken && !existing) {
      return replyError(message, `Il me faut aussi ton Riot ID : \`${prefix}profil TonPseudo#TAG ${rankText}\`.`);
    }

    const profile = store.setProfile(message.author.id, {
      riotId: riotToken || existing.riotId,
      rank: rank || existing?.rank || { key: "unranked", division: null },
    });

    // Les parties où le joueur apparaît reflètent le changement immédiatement.
    for (const match of findMatchesForPlayer(message.guildId, message.author.id)) {
      await refreshMatchMessage(message.client, match);
    }

    return replyOk(message, `Profil mis à jour : \`${profile.riotId}\` · ${formatRank(profile.rank)}`);
  },
};
