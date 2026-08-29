/**
 * Rangs Valorant : libellés FR, emojis, parsing tolérant et comparaison.
 *
 * Les emojis sont des carrés Unicode par défaut pour que le bot fonctionne sur
 * n'importe quel serveur sans configuration. Pour un rendu aux vraies couleurs
 * Valorant, uploade les icônes de rang en emojis serveur et remplace la valeur
 * `emoji` par `<:fer:123456789012345678>` — rien d'autre à changer.
 */

const RANKS = [
  { key: "unranked",  label: "Non classé", emoji: "⬛", divisions: false, aliases: ["nonclasse", "unranked", "unrank", "aucun", "none", "nc"] },
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

/** Minuscule + suppression des accents : "Diamant" et "diamant" doivent matcher. */
function normalize(input) {
  return String(input)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // supprime les accents
    .toLowerCase()
    .trim();
}

/**
 * Parse une saisie libre : "diamant 2", "Plat3", "immortel", "nc"...
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

/** "🟪 Diamant 2" — sûr même si le rang stocké est invalide/absent. */
function formatRank(rank) {
  const entry = RANK_BY_KEY.get(rank?.key) || RANK_BY_KEY.get("unranked");
  const division = entry.divisions && rank?.division ? ` ${rank.division}` : "";
  return `${entry.emoji} ${entry.label}${division}`;
}

/** Valeur numérique comparable : Fer 1 = 3, Fer 2 = 4... Radiant = 29. */
function rankValue(rank) {
  const index = RANK_ORDER.get(rank?.key) ?? 0;
  return index * 3 + (rank?.division ?? 2);
}

/** Le joueur atteint-il le rang minimum exigé par la partie ? */
function meetsMinimum(rank, minimumKey) {
  if (!minimumKey) return true;
  return (RANK_ORDER.get(rank?.key) ?? 0) >= (RANK_ORDER.get(minimumKey) ?? 0);
}

/** Choix prêts à l'emploi pour les options de commandes slash. */
function rankChoices({ includeUnranked = true } = {}) {
  return RANKS.filter((rank) => includeUnranked || rank.key !== "unranked").map((rank) => ({
    name: `${rank.emoji} ${rank.label}`,
    value: rank.key,
  }));
}

/** Liste lisible pour les messages d'erreur. */
const RANK_HELP = RANKS.map((rank) => rank.label).join(", ");

module.exports = { RANKS, RANK_BY_KEY, RANK_HELP, parseRank, formatRank, rankValue, meetsMinimum, rankChoices, normalize };
