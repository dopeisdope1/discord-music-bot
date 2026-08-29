/**
 * Verrou d'instance unique.
 *
 * Deux bots lancés avec le même token répondent tous les deux à chaque
 * commande : on voit alors une réponse ET une erreur pour le même message, ou
 * deux parties créées d'un coup. Sous Windows, `npm start` lance `node` en
 * processus enfant — tuer le `npm` laisse le `node` orphelin connecté à
 * Discord, et le problème arrive tout seul.
 *
 * Le verrou refuse donc le démarrage si une autre instance vit déjà.
 *
 * Il ne doit JAMAIS bloquer un redéploiement légitime : un verrou est considéré
 * périmé si son processus est mort, ou s'il vient d'une autre machine (nouveau
 * conteneur Railway, par exemple).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const LOCK_FILE = path.join(DATA_DIR, "bot.lock");

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(LOCK_FILE, "utf8"));
  } catch {
    return null;
  }
}

/** Le processus tourne-t-il encore ? (signal 0 = test, ne tue rien) */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM = le processus existe mais appartient à quelqu'un d'autre.
    return error.code === "EPERM";
  }
}

/**
 * @returns {{ok: true} | {ok: false, pid: number, since: string}}
 */
function acquire() {
  const existing = readLock();

  if (existing?.pid && existing.host === os.hostname() && isAlive(existing.pid)) {
    return { ok: false, pid: existing.pid, since: new Date(existing.startedAt).toLocaleString("fr-FR") };
  }

  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LOCK_FILE, JSON.stringify({
      pid: process.pid,
      host: os.hostname(),
      startedAt: Date.now(),
    }, null, 2));
  } catch (error) {
    // Un verrou non écrit ne doit pas empêcher le bot de tourner.
    console.error("[lock] Écriture du verrou impossible :", error.message);
  }
  return { ok: true };
}

/** Libère le verrou — seulement s'il nous appartient. */
function release() {
  const existing = readLock();
  if (existing?.pid !== process.pid) return;
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {
    // Déjà supprimé : rien à faire.
  }
}

module.exports = { acquire, release, LOCK_FILE };
