const { DateTime } = require("luxon");

// Paliers "Nitro", basés sur l'ancienneté du compte Discord (`user.createdAt`).
//
// ATTENTION : ce n'est PAS un vrai suivi d'abonnement Nitro. L'API bot de
// Discord n'expose rien sur le Nitro (ni statut, ni date) — `premium_type` a
// fuité un temps vers les bots (discord-api-docs#6623) puis a été patché. Ces
// paliers sont donc purement cosmétiques : ils mesurent l'âge du compte, seule
// donnée à la fois publique, automatique et exacte pour n'importe quel membre.
// Un compte de 3 ans qui n'a jamais eu Nitro affichera quand même "Emeraude".
//
// Emoji unicode faute de mieux : les 9 "application emojis" d'origine ont été
// supprimés du bot avec l'ancien système. Pour repasser à des emoji custom,
// les uploader (Developer Portal > Emojis) et remplacer les valeurs ci-dessous
// par `<:nom:id>`.
const BADGE_TIERS = [
  { months: 0, label: "Basic", emoji: "⚪" },
  { months: 1, label: "Bronze", emoji: "🟠" },
  { months: 3, label: "Argent", emoji: "⚪" },
  { months: 6, label: "Or", emoji: "🟡" },
  { months: 12, label: "Platine", emoji: "🔵" },
  { months: 24, label: "Diamant", emoji: "💎" },
  { months: 36, label: "Emeraude", emoji: "🟢" },
  { months: 60, label: "Rubis", emoji: "🔴" },
  { months: 72, label: "Opale", emoji: "🟣" },
];

// Paliers de boost, basés sur `member.premiumSince` : donnée Discord réelle
// et exacte, jamais stockée, refetchée à chaque rendu.
//
// Les emoji sont des "application emojis" uploadés sur le bot lui-même
// (Developer Portal > Emojis, ou l'endpoint /applications/{id}/emojis) :
// contrairement aux emoji de serveur, ils s'affichent partout sans que le
// bot ait besoin d'être membre du serveur qui les héberge. Pour en changer,
// re-uploader et remplacer les IDs ci-dessous.
//
// "0 Mois" réutilise le même emoji que "1 Mois" (pas d'icône dédiée).
const BOOST_TIERS = [
  { months: 0, label: "0 Mois", emoji: "<:boost_1m:1538358988196946080>" },
  { months: 1, label: "1 Mois", emoji: "<:boost_1m:1538358988196946080>" },
  { months: 2, label: "2 Mois", emoji: "<:boost_2m:1538358993561452624>" },
  { months: 3, label: "3 Mois", emoji: "<:boost_3m:1538358998577971310>" },
  { months: 6, label: "6 Mois", emoji: "<:boost_6m:1538359003535384616>" },
  { months: 9, label: "9 Mois", emoji: "<:boost_9m:1538359008623198339>" },
  { months: 12, label: "12 Mois", emoji: "<:boost_12m:1538359013643780228>" },
  { months: 15, label: "15 Mois", emoji: "<:boost_15m:1538359018848915498>" },
  { months: 18, label: "18 Mois", emoji: "<:boost_18m:1538359025433845840>" },
  { months: 24, label: "24 Mois", emoji: "<:boost_24m:1538359030676979792>" },
];

// Arithmétique en MOIS CALENDAIRES via luxon, jamais en millisecondes : un
// "mois" n'a pas de durée fixe. luxon ramène aussi les débordements au dernier
// jour du mois (31/01 + 1 mois = 28/02), là où Date.setMonth natif partirait
// sur le 3 mars — ce qui décalerait toute la timeline d'un boost commencé un 31.
function addMonths(date, months) {
  return DateTime.fromJSDate(new Date(date), { zone: "utc" }).plus({ months }).toJSDate();
}

function progressBar(percent, size = 12) {
  const filled = Math.max(0, Math.min(size, Math.round((percent / 100) * size)));
  return "▰".repeat(filled) + "▱".repeat(size - filled);
}

// Format exact de la référence pour "Date de creation" en Profile :
// "2026-06-21 11:17". C'est une chaîne fixe (pas un <t:...> Discord, qui
// s'adapterait au fuseau de chaque lecteur) : on la calcule donc en UTC de
// façon explicite, sinon la valeur dépendrait du fuseau de la machine qui
// héberge le bot et changerait au moindre déménagement d'hébergeur.
function formatDateTime(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * @param {Date|number} startDate début du suivi (création du compte, ou premiumSince)
 * @param {Array<{months:number,label:string,emoji:string}>} tiers
 * @returns {{
 *   tierDates: Array<{tier: object, date: Date}>,
 *   currentTier: object, currentTierDate: Date,
 *   nextTier: object|null, nextTierDate: Date|null,
 *   percent: number, maxed: boolean,
 * }}
 */
function computeTierState(startDate, tiers) {
  const start = new Date(startDate);
  const now = new Date();

  const tierDates = tiers.map((tier) => ({ tier, date: addMonths(start, tier.months) }));

  let currentIndex = 0;
  for (let i = 0; i < tierDates.length; i++) {
    if (tierDates[i].date <= now) currentIndex = i;
    else break;
  }

  const current = tierDates[currentIndex];
  const next = tierDates[currentIndex + 1] || null;

  let percent = 100;
  if (next) {
    const span = next.date.getTime() - current.date.getTime();
    const elapsed = now.getTime() - current.date.getTime();
    percent = Math.max(0, Math.min(100, Math.round((elapsed / span) * 100)));
  }

  return {
    tierDates,
    currentTier: current.tier,
    currentTierDate: current.date,
    nextTier: next?.tier || null,
    nextTierDate: next?.date || null,
    percent,
    maxed: !next,
  };
}

module.exports = { BADGE_TIERS, BOOST_TIERS, computeTierState, progressBar, addMonths, formatDateTime };
