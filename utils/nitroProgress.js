const { DateTime } = require("luxon");

// Paliers "Nitro" cosmétiques, calculés sur l'ancienneté du compte Discord
// (`user.createdAt`) — l'API bot n'expose aucune vraie donnée d'abonnement
// Nitro, donc ceci n'est PAS un suivi réel du Nitro, juste un habillage sur
// une donnée publique et automatique.
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

// Arithmétique en MOIS CALENDAIRES via luxon, jamais en millisecondes : un
// "mois" n'a pas de durée fixe. luxon ramène aussi les débordements au dernier
// jour du mois (31/01 + 1 mois = 28/02), là où Date.setMonth natif partirait
// sur le 3 mars.
function addMonths(date, months) {
  return DateTime.fromJSDate(new Date(date), { zone: "utc" }).plus({ months }).toJSDate();
}

function progressBar(percent, size = 12) {
  const filled = Math.max(0, Math.min(size, Math.round((percent / 100) * size)));
  return "▰".repeat(filled) + "▱".repeat(size - filled);
}

/**
 * @param {Date|number} startDate
 * @param {Array<{months:number,label:string,emoji:string}>} tiers
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

module.exports = { BADGE_TIERS, computeTierState, progressBar, addMonths };
