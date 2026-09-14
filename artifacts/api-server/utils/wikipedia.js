// Accès à Wikipédia pour &wiki et &search wiki. Isolé du reste pour que la
// commande Discord n'ait jamais à connaître le format de l'API — et que les
// tests puissent injecter un faux `fetch` plutôt que d'appeler le vrai
// Wikipédia (voir scripts/test-utility-commands.js).

const API_BASE = "https://fr.wikipedia.org";
const TIMEOUT_MS = 8000;

/**
 * Un article introuvable n'est pas une panne : `null` pour un 404, une
 * exception seulement quand Wikipédia est réellement injoignable.
 */
async function request(url, { fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "discord-music-bot (commande &wiki)", Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Wikipédia a répondu ${response.status}`);
  return response.json();
}

/** Résumé d'un article : titre, extrait, lien, vignette. `null` si inexistant. */
async function summary(term, options = {}) {
  const data = await request(`${API_BASE}/api/rest_v1/page/summary/${encodeURIComponent(term)}?redirect=true`, options);
  if (!data || data.type === "https://mediawiki.org/wiki/HyperSwitch/errors/not_found") return null;
  return {
    title: data.title,
    extract: data.extract || "*Cet article n'a pas de résumé.*",
    url: data.content_urls?.desktop?.page || `${API_BASE}/wiki/${encodeURIComponent(term)}`,
    thumbnail: data.thumbnail?.source || null,
    disambiguation: data.type === "disambiguation",
  };
}

/** Liste d'articles correspondant au mot-clé (10 maximum), triés par pertinence. */
async function search(term, options = {}) {
  const url =
    `${API_BASE}/w/api.php?action=query&list=search&format=json&srlimit=10` +
    `&srsearch=${encodeURIComponent(term)}`;
  const data = await request(url, options);
  return (data?.query?.search || []).map((hit) => ({
    title: hit.title,
    url: `${API_BASE}/wiki/${encodeURIComponent(hit.title.replace(/ /g, "_"))}`,
    // `snippet` arrive en HTML (les mots trouvés sont en <span class="searchmatch">).
    snippet: (hit.snippet || "").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim(),
  }));
}

module.exports = { summary, search, API_BASE };
