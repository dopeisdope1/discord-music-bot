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

const SPOTIFY_PLAYLIST_RE = /open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/i;

// Les playlists que Spotify génère POUR UN COMPTE (Daily Mix, Discover
// Weekly, On Repeat, Blend...) portent un identifiant en 37i9dQZF1E/1F et
// renvoient un résultat vide à toute application : elles n'existent que pour
// leur destinataire. Les playlists éditoriales (37i9dQZF1DX...) se chargent
// normalement, d'où la distinction faite dans le message.
const SPOTIFY_PERSONALIZED_RE = /^37i9dQZF1[EF]/;

/**
 * Message affiché quand une recherche n'a rien donné. Distingue les causes
 * réelles au lieu du "vérifie le lien" générique, qui envoyait sur une
 * fausse piste alors que le lien fourni était parfaitement valide.
 * @param {string} query — ce que la personne a tapé
 */
function unresolvedQueryMessage(query = "") {
  const playlist = query.match(SPOTIFY_PLAYLIST_RE);

  if (playlist) {
    if (SPOTIFY_PERSONALIZED_RE.test(playlist[1])) {
      return (
        "Cette playlist est générée par Spotify pour ton compte (Daily Mix, Discover Weekly, Blend...). " +
        "Elle n'existe que pour toi, aucun bot ne peut la lire. " +
        "Copie ses titres dans une playlist à toi et passe-la en public."
      );
    }
    return (
      "Playlist introuvable. Pour que je puisse la lire, elle doit être **publique** — " +
      "vérifie ses paramètres de partage dans Spotify."
    );
  }

  if (/^https?:\/\//i.test(query)) {
    return "Je n'arrive pas à lire ce lien. Le titre est peut-être privé, supprimé, ou indisponible.";
  }

  return "Aucun résultat pour cette recherche. Essaie avec le nom de l'artiste en plus du titre.";
}

module.exports = { isNoNodesOnlineError, playbackErrorMessage, unresolvedQueryMessage };
