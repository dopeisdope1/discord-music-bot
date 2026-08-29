/**
 * `custom` — crée une partie personnalisée et poste son panneau interactif.
 *
 *   +custom                       → 5 vs 5
 *   +custom 2v2                   → format libre
 *   +custom 5v5 ascent            → avec une map
 *   +custom 5v5 ascent diamant    → avec un rang minimum
 *   +custom sansmoi               → sans t'inscrire en Équipe 1
 *
 * Les arguments sont reconnus dans n'importe quel ordre.
 */

const config = require("../config");
const store = require("../utils/store");
const access = require("../utils/access");
const settings = require("../utils/settings");
const { logEvent } = require("../utils/logger");
const { parseRank, formatRank, normalize, RANK_BY_KEY } = require("../utils/ranks");
const { createMatch, addToTeam } = require("../utils/matches");
const { buildMatchPanel } = require("../utils/display");
const { replyError, replyOk } = require("../utils/reply");

const NO_JOIN = ["sansmoi", "nojoin", "spectateur", "host"];
const RANDOM_MAP = ["aleatoire", "random", "hasard"];

/** Reconnaît format / map / rang / options, dans n'importe quel ordre. */
function parseArgs(args) {
  const parsed = { format: null, map: null, minRank: null, autoJoin: true, unknown: [] };

  for (const raw of args) {
    const token = normalize(raw);
    if (!token) continue;

    const formatMatch = token.match(/^(\d)\s*(?:v|vs)\s*(\d)$/);
    if (formatMatch && formatMatch[1] === formatMatch[2]) {
      const perTeam = Number(formatMatch[1]);
      parsed.format = config.formats.find((f) => f.perTeam === perTeam)
        || { key: `${perTeam}v${perTeam}`, label: `${perTeam}v${perTeam}`, perTeam };
      continue;
    }

    if (NO_JOIN.includes(token)) { parsed.autoJoin = false; continue; }
    if (RANDOM_MAP.includes(token)) { parsed.map = config.maps[Math.floor(Math.random() * config.maps.length)]; continue; }

    const map = config.maps.find((entry) => normalize(entry) === token);
    if (map) { parsed.map = map; continue; }

    const rank = parseRank(token);
    if (rank) { parsed.minRank = rank.key; continue; }

    parsed.unknown.push(raw);
  }

  return parsed;
}

module.exports = {
  name: "custom",
  aliases: ["partie", "cust"],
  description: "Crée une partie personnalisée",
  usage: "custom [5v5] [map] [rang minimum] [sansmoi]",

  async execute(message, args) {
    // Verrou activable depuis le panneau : création réservée aux autorisés.
    if (settings.get("restrictCreation") && !access.isManager(message.author.id)) {
      return replyError(message, "La création de parties est réservée aux membres autorisés par le propriétaire du bot.");
    }

    const parsed = parseArgs(args);
    if (parsed.unknown.length) {
      return replyError(
        message,
        `Argument non reconnu : \`${parsed.unknown.join("`, `")}\`.\n` +
        `Exemples : \`${settings.get("prefix")}custom\`, \`${settings.get("prefix")}custom 2v2\`, ` +
        `\`${settings.get("prefix")}custom 5v5 ascent diamant\`.`,
      );
    }

    const format = parsed.format || config.formats[0];
    const match = createMatch({
      guildId: message.guildId,
      channelId: message.channelId,
      hostId: message.author.id,
      format,
      map: parsed.map,
      minRank: parsed.minRank,
    });

    // L'hôte s'inscrit d'office s'il joue ET s'il a déjà un profil : sans
    // profil, on ne peut pas afficher son pseudo/rang dans le panneau.
    const profile = store.getProfile(message.author.id);
    if (parsed.autoJoin && profile) addToTeam(match, message.author.id, 1);

    // Enregistrée AVANT l'envoi : si quelqu'un clique dans la milliseconde qui
    // suit, la partie est déjà connue du bot.
    store.putMatch(match);

    const panel = await message.channel.send(buildMatchPanel(match));
    match.messageId = panel.id;
    store.save();

    logEvent(message.client, "create", {
      matchId: match.id,
      description: `Partie ${format.label} créée par <@${message.author.id}>${parsed.map ? ` sur **${parsed.map}**` : ""}.`,
    });

    if (parsed.autoJoin && !profile) {
      return replyError(
        message,
        "Partie créée, mais tu n'as pas encore de profil Valorant : tu n'as donc pas été inscrit.\n" +
        `Clique sur **Rejoindre Équipe 1** (une fenêtre s'ouvrira) ou fais \`${settings.get("prefix")}profil TonPseudo#TAG Diamant 2\`.`,
      );
    }

    if (parsed.minRank) {
      const rank = RANK_BY_KEY.get(parsed.minRank);
      return replyOk(message, `Partie créée — rang minimum **${rank.emoji} ${rank.label}**${profile ? `, tu es inscrit avec ${formatRank(profile.rank)}` : ""}.`);
    }
    return replyOk(message, "Partie créée.");
  },
};
