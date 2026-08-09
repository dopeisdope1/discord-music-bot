// Clé publique de démo Giphy (documentée par Giphy eux-mêmes pour les tests,
// utilisée par défaut par de nombreux bots open-source) : suffisante pour un
// petit serveur, mais soumise à un rate-limit bas. Définis GIPHY_API_KEY dans
// .env avec ta propre clé (gratuite sur https://developers.giphy.com/) pour
// des limites plus confortables.
const GIPHY_API_KEY = process.env.GIPHY_API_KEY || "dc6zaTOxFJmzC";

/**
 * Cherche un gif sur Giphy et en renvoie un au hasard parmi les meilleurs
 * résultats (plutôt que toujours le premier, pour varier).
 * @param {string} query
 * @returns {Promise<string|null>} URL du gif, ou null si aucun résultat
 */
async function searchGif(query) {
  const url = `https://api.giphy.com/v1/gifs/search?api_key=${GIPHY_API_KEY}&q=${encodeURIComponent(
    query
  )}&limit=15&rating=pg-13&lang=fr`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Giphy API a répondu ${res.status}`);
  const data = await res.json();
  const results = data?.data || [];
  if (results.length === 0) return null;

  const pick = results[Math.floor(Math.random() * results.length)];
  return pick.images?.original?.url || pick.images?.downsized?.url || null;
}

module.exports = { searchGif };
