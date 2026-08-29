/**
 * Verrou par clé — sérialise les sections critiques d'une même partie.
 *
 * Node est mono-thread, mais chaque `await` rend la main : deux joueurs qui
 * cliquent « Prendre la place » à la même milliseconde peuvent tous les deux
 * passer la vérification « la place est-elle libre ? » avant que l'un des deux
 * ne l'occupe. Le résultat serait 6 joueurs dans une équipe de 5.
 *
 * On enchaîne donc les actions d'une même partie sur une file :
 *
 *   await withLock(`match:${match.id}`, async () => { … });
 *
 * Une tâche qui échoue ne bloque jamais la file : la chaîne interne avale les
 * erreurs, mais l'appelant, lui, reçoit bien le rejet d'origine.
 */

/** @type {Map<string, Promise<void>>} dernière tâche en cours par clé */
const queues = new Map();

/**
 * @template T
 * @param {string} key    clé de sérialisation (ex. `match:a1b2c3`)
 * @param {() => Promise<T>|T} task
 * @returns {Promise<T>}
 */
function withLock(key, task) {
  const previous = queues.get(key) || Promise.resolve();

  const run = previous.then(() => task());
  // La file continue même si la tâche a échoué.
  const next = run.then(() => {}, () => {});
  queues.set(key, next);

  // Nettoyage : si personne ne s'est mis derrière nous entre-temps, on libère
  // la clé pour ne pas faire grossir la Map indéfiniment (fuite mémoire).
  next.then(() => {
    if (queues.get(key) === next) queues.delete(key);
  });

  return run;
}

/** Nombre de clés verrouillées — utile pour le diagnostic dans le panneau. */
const pendingLocks = () => queues.size;

module.exports = { withLock, pendingLocks };
