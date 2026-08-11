// Analyse une durée courte type "10m"/"1h"/"1j" en millisecondes (par défaut
// en minutes si l'unité est omise). Retourne null si le format est invalide.
// Partagé entre utils/moderationCommands.js (mute/tempban/...) et
// utils/antifastCommands.js (creation/pingraid...).
function parseDuration(input) {
  const match = /^(\d+)\s*(s|m|h|d|j)?$/i.exec((input || "").trim());
  if (!match) return null;
  const amount = parseInt(match[1], 10);
  const unit = (match[2] || "m").toLowerCase();
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, j: 86_400_000 };
  return amount * multipliers[unit];
}

function formatDuration(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}j`;
}

module.exports = { parseDuration, formatDuration };
