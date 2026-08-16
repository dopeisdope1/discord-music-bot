// Paliers "Badge" (façon Nitro, mais basés sur l'ancienneté du compte Discord
// — la vraie date d'abonnement Nitro n'est pas accessible aux bots) et
// "Boost" (basés sur `member.premiumSince`, donnée réelle). Seuils en mois
// depuis la date de départ, repris tels quels des captures fournies.
const BADGE_TIERS = [
  { months: 0, label: "Basic", emoji: "⚪" },
  { months: 1, label: "Bronze", emoji: "🥉" },
  { months: 3, label: "Argent", emoji: "🥈" },
  { months: 6, label: "Or", emoji: "🥇" },
  { months: 12, label: "Platine", emoji: "💠" },
  { months: 24, label: "Diamant", emoji: "💎" },
  { months: 36, label: "Emeraude", emoji: "💚" },
  { months: 60, label: "Rubis", emoji: "❤️" },
  { months: 72, label: "Opale", emoji: "🤍" },
];

const BOOST_TIERS = [
  { months: 0, label: "0 Mois", emoji: "🔺" },
  { months: 1, label: "1 Mois", emoji: "🔺" },
  { months: 2, label: "2 Mois", emoji: "🔺" },
  { months: 3, label: "3 Mois", emoji: "🔺" },
  { months: 6, label: "6 Mois", emoji: "🔺" },
  { months: 9, label: "9 Mois", emoji: "🔺" },
  { months: 12, label: "12 Mois", emoji: "🔺" },
  { months: 15, label: "15 Mois", emoji: "🔺" },
  { months: 18, label: "18 Mois", emoji: "🔺" },
  { months: 24, label: "24 Mois", emoji: "🔺" },
];

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function progressBar(percent, size = 10) {
  const filled = Math.max(0, Math.min(size, Math.round((percent / 100) * size)));
  return "▓".repeat(filled) + "░".repeat(size - filled);
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

module.exports = { BADGE_TIERS, BOOST_TIERS, computeTierState, progressBar, addMonths };
