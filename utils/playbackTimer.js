// Suit la position de lecture par serveur (Kazagumo n'expose pas de position
// en direct), pour pouvoir afficher une barre de progression qui avance dans
// le panel "En cours de lecture".
const timers = new Map();

function startTracking(guildId, initialElapsedMs = 0) {
  timers.set(guildId, { startedAt: Date.now() - initialElapsedMs, pausedAt: null, pausedMs: 0 });
}

function setPaused(guildId, paused) {
  const t = timers.get(guildId);
  if (!t) return;
  if (paused && !t.pausedAt) {
    t.pausedAt = Date.now();
  } else if (!paused && t.pausedAt) {
    t.pausedMs += Date.now() - t.pausedAt;
    t.pausedAt = null;
  }
}

function getElapsedMs(guildId) {
  const t = timers.get(guildId);
  if (!t) return 0;
  const pausedMs = t.pausedMs + (t.pausedAt ? Date.now() - t.pausedAt : 0);
  return Math.max(0, Date.now() - t.startedAt - pausedMs);
}

function stopTracking(guildId) {
  timers.delete(guildId);
}

module.exports = { startTracking, setPaused, getElapsedMs, stopTracking };
