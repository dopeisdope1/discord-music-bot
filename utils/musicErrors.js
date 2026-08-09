/**
 * Vrai si l'erreur vient de Kazagumo/Shoukaku signalant qu'aucun nœud
 * Lavalink n'est actuellement connecté (typiquement pendant une reconnexion
 * après une coupure du nœud public gratuit).
 */
function isNoNodesOnlineError(err) {
  return typeof err?.message === "string" && err.message.includes("No nodes are online");
}

/**
 * Message d'erreur adapté selon la cause : plus clair pour une indisponibilité
 * temporaire du serveur audio que pour un vrai échec de lecture.
 */
function playbackErrorMessage(err, fallback) {
  if (isNoNodesOnlineError(err)) {
    return "Le serveur audio redémarre suite à une coupure, réessaie dans quelques secondes.";
  }
  return fallback;
}

module.exports = { isNoNodesOnlineError, playbackErrorMessage };
