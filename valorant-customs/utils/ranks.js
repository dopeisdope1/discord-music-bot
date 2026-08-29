/**
 * Rangs Valorant : libellés FR, emojis, parsing tolérant, conversion depuis
 * l'API (tier Riot) et valeur numérique utilisée par l'équilibrage.
 *
 * Les emojis sont des carrés Unicode par défaut pour que le bot fonctionne sur
 * n'importe quel serveur sans configuration. Pour un rendu aux vraies couleurs
 * Valorant, uploade les icônes de rang en emojis serveur et renseigne-les
 * depuis le panneau (🎨 Apparence) — aucun fichier à éditer.
 *
 * ⚠️ L'ordre du tableau RANKS est significatif : c'est lui qui convertit un
 * `tier` Riot (0 = non classé, 3-5 = Fer 1-3, … 27 = Radiant) en rang.
 */

const RANKS = [
  { key: "unranked",  label: "Non classé", emoji: "⬛", divisions: false, aliases: ["nonclasse", "unranked", "unrated", "unrank", "aucun", "none", "nc"] },
  { key: "iron",      label: "Fer",        emoji: "🟫", divisions: true,  aliases: ["fer", "iron"] },
  { key: "bronze",    label: "Bronze",     emoji: "🟧", divisions: true,  aliases: ["bronze"] },
  { key: "silver",    label: "Argent",     emoji: "⬜", divisions: true,  aliases: ["argent", "silver", "arg"] },
  { key: "gold",      label: "Or",         emoji: "🟨", divisions: true,  aliases: ["or", "gold"] },
  { key: "platinum",  label: "Platine",    emoji: "🟦", divisions: true,  aliases: ["platine", "platinum", "plat"] },
  { key: "diamond",   label: "Diamant",    emoji: "🟪", divisions: true,  aliases: ["diamant", "diamond", "diam", "dia"] },
  { key: "ascendant", label: "Ascendant",  emoji: "🟩", divisions: true,  aliases: ["ascendant", "ascendent", "asc"] },
  { key: "immortal",  label: "Immortel",   emoji: "🟥", divisions: true,  aliases: ["immortel", "immortal", "immo", "imm"] },
  { key: "radiant",   label: "Radiant",    emoji: "🌟", divisions: false, aliases: ["radiant", "rad"] },
];

const RANK_BY_KEY = new Map(RANKS.map((rank) => [rank.key, rank]));
const RANK_ORDER = new Map(RANKS.map((rank, index) => [rank.key, index]));

const UNRANKED = { key: "unranked", division: null };

/** Minuscule + suppression des accents : "Diamant" et "diamant" doivent matcher. */
function normalize(input) {
  return String(input)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // supprime les accents
    .toLowerCase()
    .trim();
}

/**
 * Parse une saisie libre : "diamant 2", "Plat3", "Ascendant 1", "immortel", "nc"…
 * Fonctionne aussi sur les libellés anglais renvoyés par l'API ("Gold 2").
 *
 * @returns {{key: string, division: number|null}|null} null si non reconnu.
 */
function parseRank(input) {
  if (!input) return null;
  const raw = normalize(input);

  // La division est le dernier chiffre 1-3 de la chaîne ("diamant 2", "plat3").
  const divisionMatch = raw.match(/([1-3])\s*$/);
  const division = divisionMatch ? Number(divisionMatch[1]) : null;
  const namePart = raw.replace(/[^a-z]/g, "");
  if (!namePart) return null;

  const rank = RANKS.find((entry) => entry.aliases.some((alias) => namePart === alias || namePart.startsWith(alias)));
  if (!rank) return null;

  return { key: rank.key, division: rank.divisions ? division : null };
}

/**
 * Conversion du `tier` numérique de Riot — la source la plus fiable, car elle
 * ne dépend ni de la langue ni du libellé renvoyé par l'API.
 *
 *   0        → Non classé
 *   3,4,5    → Fer 1, 2, 3
 *   6,7,8    → Bronze 1, 2, 3
 *   …
 *   24,25,26 → Immortel 1, 2, 3
 *   27       → Radiant
 */
function rankFromTierId(tierId) {
  const id = Number(tierId);
  if (!Number.isFinite(id) || id < 3) return { ...UNRANKED };

  const index = Math.floor(id / 3);
  const rank = RANKS[Math.min(index, RANKS.length - 1)];
  if (!rank) return { ...UNRANKED };

  return { key: rank.key, division: rank.divisions ? (id % 3) + 1 : null };
}

/** Filet de sécurité quand l'API ne renvoie qu'un libellé ("Ascendant 2"). */
function rankFromTierName(name) {
  return parseRank(name) || { ...UNRANKED };
}

/**
 * Emoji d'un rang : celui défini depuis le panneau s'il y en a un, sinon le
 * carré Unicode par défaut.
 */
function rankEmoji(key) {
  // require paresseux : settings ne dépend pas de ranks, mais on évite ainsi
  // toute surprise d'ordre de chargement.
  const settings = require("./settings");
  const custom = settings.get("rankEmojis") || {};
  return custom[key] || RANK_BY_KEY.get(key)?.emoji || "⬛";
}

const rankLabel = (key) => RANK_BY_KEY.get(key)?.label || "Non classé";

/**
 * "🟪 Diamant 2" — ou "🟪 Diamant 2 · 54 RR" si le RR est connu.
 * Sûr même si le rang stocké est invalide ou absent.
 */
function formatRank(rank, { rr = null } = {}) {
  const entry = RANK_BY_KEY.get(rank?.key) || RANK_BY_KEY.get("unranked");
  const division = entry.divisions && rank?.division ? ` ${rank.division}` : "";
  const points = Number.isFinite(rr) && entry.key !== "unranked" ? ` · ${rr} RR` : "";
  return `${rankEmoji(entry.key)} ${entry.label}${division}${points}`;
}

/** Valeur numérique comparable : Fer 1 = 4, Fer 2 = 5… Radiant = 29. */
function rankValue(rank) {
  const index = RANK_ORDER.get(rank?.key) ?? 0;
  return index * 3 + (rank?.division ?? 2);
}

/**
 * Force d'un joueur pour l'équilibrage des équipes.
 *
 * Le RR affine le classement à l'intérieur d'un palier : un Or 3 à 90 RR est
 * plus proche d'un Platine 1 que d'un Or 3 à 5 RR.
 *
 * @returns {number|null} null si le rang est inconnu — l'appelant remplace
 *          alors par la médiane du lobby plutôt que d'inventer une valeur.
 */
function strength(rank, rr = null) {
  if (!rank || rank.key === "unranked" || !RANK_BY_KEY.has(rank.key)) return null;
  const points = Number.isFinite(rr) ? Math.max(0, Math.min(Number(rr), 99)) : 50;
  return rankValue(rank) * 100 + points;
}

/** Le joueur atteint-il le rang minimum exigé par la partie ? */
function meetsMinimum(rank, minimumKey) {
  if (!minimumKey) return true;
  return (RANK_ORDER.get(rank?.key) ?? 0) >= (RANK_ORDER.get(minimumKey) ?? 0);
}

/** Choix prêts à l'emploi pour les menus déroulants. */
function rankChoices({ includeUnranked = true } = {}) {
  return RANKS.filter((rank) => includeUnranked || rank.key !== "unranked").map((rank) => ({
    name: `${rank.emoji} ${rank.label}`,
    value: rank.key,
  }));
}

/** Liste lisible pour les messages d'erreur. */
const RANK_HELP = RANKS.map((rank) => rank.label).join(", ");

module.exports = {
  RANKS, RANK_BY_KEY, RANK_HELP, UNRANKED,
  parseRank, rankFromTierId, rankFromTierName,
  formatRank, rankEmoji, rankLabel, rankValue, strength,
  meetsMinimum, rankChoices, normalize,
};
