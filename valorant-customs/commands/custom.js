/**
 * `custom` — crée une partie personnalisée et poste son panneau interactif.
 *
 *   +custom                       → 5 vs 5
 *   +custom 2v2                   → format libre
 *   +custom 5v5 ascent            → avec une map
 *   +custom 5v5 ascent diamant    → avec un rang minimum
 *   +custom 21h30                 → lancement automatique à 21h30
 *   +custom sansmoi               → sans t'inscrire en Équipe 1
 *
 * Les arguments sont reconnus dans n'importe quel ordre.
 */

const config = require("../config");
const store = require("../utils/store");
const access = require("../utils/access");
const settings = require("../utils/settings");
const { logEvent } = require("../utils/logger");
const { parseRank, formatRank, normalize, rankEmoji, RANK_BY_KEY } = require("../utils/ranks");
const { createMatch, addToTeam } = require("../utils/matches");
const { buildMatchPanel } = require("../utils/display");
const automation = require("../utils/automation");
const { replyError, replyOk } = require("../utils/reply");

const NO_JOIN = ["sansmoi", "nojoin", "spectateur", "host"];
const RANDOM_MAP = ["aleatoire", "random", "hasard"];

/**
 * Heure de début : `21h`, `21h30`, `21:30`, `9h05`.
 * Interprétée dans le fuseau du serveur ; si l'heure est déjà passée
 * aujourd'hui, c'est pour demain.
 *
 * @returns {number|null} timestamp en millisecondes
 */
function parseStartTime(token) {
  const match = token.match(/^(\d{1,2})\s*[h:]\s*(\d{2})?$/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  if (hours > 23 || minutes > 59) return null;

  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
  return date.getTime();
}

/** Reconnaît format / map / rang / heure / options, dans n'importe quel ordre. */
function parseArgs(args) {
  const parsed = { format: null, map: null, minRank: null, startAt: null, autoJoin: true, unknown: [] };

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

    const startAt = parseStartTime(token);
    if (startAt) { parsed.startAt = startAt; continue; }

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
  usage: "custom [5v5] [map] [rang] [21h30] [sansmoi]",
  tier: "player",

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
      startAt: parsed.startAt,
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

    // Lancement programmé : le bot ouvrira les salons tout seul à l'heure dite.
    if (parsed.startAt) automation.scheduleStart(message.client, match.id, parsed.startAt);

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

    if (parsed.startAt) {
      const stamp = Math.floor(parsed.startAt / 1000);
      return replyOk(message, `Partie créée — lancement automatique <t:${stamp}:t> (<t:${stamp}:R>).`);
    }

    if (parsed.minRank) {
      const rank = RANK_BY_KEY.get(parsed.minRank);
      return replyOk(message, `Partie créée — rang minimum **${rankEmoji(rank.key)} ${rank.label}**${profile ? `, tu es inscrit avec ${formatRank(profile.rank)}` : ""}.`);
    }
    return replyOk(message, "Partie créée.");
  },
};
