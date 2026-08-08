let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  const basic = Buffer.from(
    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Authentification Spotify échouée (${res.status})`);

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

async function spotifyGet(endpoint, params = {}) {
  const token = await getAccessToken();
  const url = new URL(`https://api.spotify.com/v1${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Erreur API Spotify (${res.status})`);
  return res.json();
}

function formatTrackDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function trackArtists(track) {
  return track.artists.map((a) => a.name).join(", ");
}

async function searchArtist(query) {
  const data = await spotifyGet("/search", { q: query, type: "artist", limit: "1" });
  return data.artists?.items?.[0] || null;
}

async function getArtistTopTracks(artistId, market = "FR") {
  const data = await spotifyGet(`/artists/${artistId}/top-tracks`, { market });
  return data.tracks || [];
}

async function searchTracks(query, limit = 10) {
  const data = await spotifyGet("/search", { q: query, type: "track", limit: String(limit) });
  return data.tracks?.items || [];
}

/**
 * Résout une recherche texte ("!play <texte>") en une liste de titres Spotify.
 * Si la requête correspond exactement au nom d'un artiste, renvoie son top titres
 * ({ mode: "artist" }). Sinon, renvoie les résultats de recherche de titres
 * ({ mode: "track" }).
 */
async function resolveSpotifyQuery(query) {
  const artist = await searchArtist(query);
  if (artist && artist.name.trim().toLowerCase() === query.trim().toLowerCase()) {
    const tracks = await getArtistTopTracks(artist.id);
    return { mode: "artist", artist, tracks: tracks.slice(0, 10) };
  }
  const tracks = await searchTracks(query, 10);
  return { mode: "track", tracks };
}

module.exports = { resolveSpotifyQuery, formatTrackDuration, trackArtists };
