// Paliers "Nitro" (basés sur l'arrivée sur le serveur — la vraie date
// d'abonnement Nitro n'est pas accessible aux bots) et "Boost" (basés sur
// `member.premiumSince`, donnée réelle).
//
// Les emoji sont des "application emojis" uploadés sur le bot lui-même
// (Developer Portal > Emojis, ou l'endpoint /applications/{id}/emojis) :
// contrairement aux emoji de serveur, ils s'affichent partout sans que le
// bot ait besoin d'être membre du serveur qui les héberge. Pour en changer,
// re-uploader et remplacer les IDs ci-dessous.
const BADGE_TIERS = [
  { months: 0, label: "Basic", emoji: "<:discordnitro:1538358941786964060>" },
  { months: 1, label: "Bronze", emoji: "<:nitrobronze:1538358946581184552>" },
  { months: 3, label: "Argent", emoji: "<:silvernitrotier:1538358952167870565>" },
  { months: 6, label: "Or", emoji: "<:goldnitrotier:1538358957578653727>" },
  { months: 12, label: "Platine", emoji: "<:platiniumnitrotier:1538358962884186264>" },
  { months: 24, label: "Diamant", emoji: "<:diamondnitrotier:1538358968500359263>" },
  { months: 36, label: "Emeraude", emoji: "<:emeraldnitrotier:1538358973743366236>" },
  { months: 60, label: "Rubis", emoji: "<:rubynitrotier:1538358978805895239>" },
  { months: 72, label: "Opale", emoji: "<:opalnitrotier:1538358983461707907>" },
];

// "0 Mois" réutilise le même emoji que "1 Mois" (pas d'icône dédiée côté
// référence, voir la donnée brute fournie).
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
