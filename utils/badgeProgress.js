// Paliers "Nitro" (basés sur l'ancienneté du compte Discord — la vraie date
// d'abonnement Nitro n'est pas accessible aux bots) et "Boost" (basés sur
// `member.premiumSince`, donnée réelle). Seuils + emoji custom exacts
// fournis par l'utilisateur (repris du bot de référence).
const BADGE_TIERS = [
  { months: 0, label: "Basic", emoji: "<:discordnitro:1494668168520794162>" },
  { months: 1, label: "Bronze", emoji: "<:nitrobronze:1494667676583334039>" },
  { months: 3, label: "Argent", emoji: "<:silvernitrotier:1494667799543550145>" },
  { months: 6, label: "Or", emoji: "<:goldnitrotier:1494667951465431161>" },
  { months: 12, label: "Platine", emoji: "<:platiniumnitrotier:1494668052510408884>" },
  { months: 24, label: "Diamant", emoji: "<:diamondnitrotier:1494668283733868745>" },
  { months: 36, label: "Emeraude", emoji: "<:emeraldnitrotier:1494668375635529899>" },
  { months: 60, label: "Rubis", emoji: "<:rubynitrotier:1494668499535265842>" },
  { months: 72, label: "Opale", emoji: "<:opalnitrotier:1494668626618224650>" },
];

// "0 Mois" réutilise le même emoji que "1 Mois" (pas d'icône dédiée côté
// référence, voir la donnée brute fournie).
const BOOST_TIERS = [
  { months: 0, label: "0 Mois", emoji: "<:1_1m:1494669207437054093>" },
  { months: 1, label: "1 Mois", emoji: "<:1_1m:1494669207437054093>" },
  { months: 2, label: "2 Mois", emoji: "<:1_2m:1494669216337498392>" },
  { months: 3, label: "3 Mois", emoji: "<:1_3m:1494669219286224978>" },
  { months: 6, label: "6 Mois", emoji: "<:1_6m:1494669224080179201>" },
  { months: 9, label: "9 Mois", emoji: "<:1_9m:1494669226747887728>" },
  { months: 12, label: "12 Mois", emoji: "<:1_12m:1494669188491378899>" },
  { months: 15, label: "15 Mois", emoji: "<:1_15m:1494669192782282822>" },
  { months: 18, label: "18 Mois", emoji: "<:1_18m:1494669203557584949>" },
  { months: 24, label: "24 Mois", emoji: "<:1_24m:1494669213317468260>" },
];

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function progressBar(percent, size = 12) {
  const filled = Math.max(0, Math.min(size, Math.round((percent / 100) * size)));
  return "▰".repeat(filled) + "▱".repeat(size - filled);
}

// Format exact de la référence pour "Date de creation" en Profile :
// "2026-06-21 11:17" (pas un timestamp Discord <t:...> ici, une chaîne fixe).
function formatDateTime(date) {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
