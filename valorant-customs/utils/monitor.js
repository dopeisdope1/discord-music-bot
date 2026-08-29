/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MONITEUR DE PARTIES — un seul timer pour tout le bot
 * ═══════════════════════════════════════════════════════════════════════
 *
 * `voiceStateUpdate` réagit à l'instant : c'est lui qui annule un
 * avertissement dès que le joueur arrive. Mais un événement peut manquer —
 * coupure de gateway, redémarrage, salon supprimé à la main, permission
 * retirée en cours de route. Ce moniteur est le **filet de sécurité** :
 * toutes les 15 secondes, il compare l'état réel à l'état attendu.
 *
 * Ce qu'il NE fait pas, volontairement :
 *   • pas un `setInterval` par joueur ni par partie — **un seul** pour tout
 *     le bot, démarré à la première partie lancée, arrêté dès qu'il n'y en a
 *     plus. Aucune fuite mémoire, aucun timer orphelin ;
 *   • pas de ré-édition du panneau à chaque tick : les comptes à rebours sont
 *     des horodatages Discord (`<t:…:R>`), animés côté client sans coûter la
 *     moindre requête. On ne redessine que si l'état a **réellement** changé.
 */

const store = require("./store");
const settings = require("./settings");
const { logEvent } = require("./logger");
const { refreshMatchMessage } = require("./matches");
const {
  ensureTeamChannels, syncTeamPermissions, isInTeamVoice, presenceSnapshot,
} = require("./voice");
const warnings = require("./warnings");

const TICK_MS = 15_000;

/** @type {NodeJS.Timeout|null} l'unique minuterie du moniteur */
let timer = null;
let running = false;

/** Dernière photo de présence connue, par partie : détecte les changements. */
const lastSeen = new Map();

const liveMatches = () => store.allMatches().filter((match) => match.status === "live");

// ─────────────────────────── cycle de vie ───────────────────────────

/**
 * Démarre le moniteur s'il ne tourne pas déjà. Idempotent : on peut l'appeler
 * à chaque lancement de partie sans risque d'empiler les minuteries.
 */
function watch(client) {
  if (timer) return;

  timer = setInterval(() => {
    if (running) return; // un tick lent ne doit pas en déclencher un second
    running = true;
    tick(client)
      .catch((error) => console.error("[monitor] Tick en échec :", error.message))
      .finally(() => { running = false; });
  }, TICK_MS);

  // Le moniteur ne doit jamais retenir le process au moment de l'arrêt.
  timer.unref?.();
  console.log("[monitor] Surveillance des parties démarrée.");
}

/** Arrête le moniteur et oublie tout état — appelé quand plus rien ne tourne. */
function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  lastSeen.clear();
  console.log("[monitor] Plus aucune partie en cours — surveillance arrêtée.");
}

// ────────────────────────────── un tick ──────────────────────────────

async function tick(client) {
  const matches = liveMatches();
  if (!matches.length) {
    stop();
    return;
  }

  for (const match of matches) {
    try {
      await inspect(client, match);
    } catch (error) {
      console.error(`[monitor] Inspection impossible (#${match.id}) :`, error.message);
    }
  }

  // Ménage : les parties terminées ne laissent rien derrière elles.
  for (const matchId of [...lastSeen.keys()]) {
    if (!matches.some((match) => match.id === matchId)) lastSeen.delete(matchId);
  }
}

/**
 * Contrôle d'une partie : salons vivants, permissions à jour, présence réelle.
 */
async function inspect(client, match) {
  const guild = await client.guilds.fetch(match.guildId).catch(() => null);
  if (!guild) return;

  // ---- 1. Les salons existent-ils encore ? ----
  const { recreated, error } = await ensureTeamChannels(guild, match, null);
  if (error) {
    logEvent(client, "error", {
      matchId: match.id,
      description: `Salon d'équipe manquant et impossible à recréer : ${error}`,
    });
  } else if (recreated.length) {
    store.save();
    logEvent(client, "voice", {
      matchId: match.id,
      description: `Salon(s) d'équipe ${recreated.join(" et ")} recréé(s) : ils avaient été supprimés.`,
    });
    for (const teamNo of recreated) await syncTeamPermissions(guild, match, teamNo);
    await refreshMatchMessage(client, match);
  }

  // ---- 2. Présence : qui est parti, qui est revenu ? ----
  const presence = presenceSnapshot(guild, match);
  const previous = lastSeen.get(match.id);
  const signature = [...presence.entries()].map(([id, ok]) => `${id}:${ok ? 1 : 0}`).sort().join("|");

  if (previous !== signature) {
    lastSeen.set(match.id, signature);
    // L'état affiché n'est plus le bon : on redessine, mais seulement là.
    await refreshMatchMessage(client, match);
  }

  if (!settings.get("autoWarnOnLeave")) return;

  // ---- 3. Absents non encore avertis ----
  for (const teamNo of [1, 2]) {
    for (const userId of match.teams[teamNo]) {
      if (match.warnings?.[userId]) continue;          // déjà sous avertissement
      if (presence.get(userId)) continue;              // présent, rien à faire

      // Double vérification côté API : le cache de présence peut avoir du
      // retard juste après un déplacement.
      const present = await isInTeamVoice(guild, match, teamNo, userId);
      if (present) continue;

      await warnings.startWarning(client, match, userId, client.user.id);
    }
  }
}

/** Nombre de parties surveillées — affiché dans le panneau de contrôle. */
const status = () => ({ running: Boolean(timer), matches: liveMatches().length, tickMs: TICK_MS });

module.exports = { watch, stop, status };
