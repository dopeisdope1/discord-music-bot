/**
 * ═══════════════════════════════════════════════════════════════════════
 *  CLIENT API — RANG VALORANT RÉEL
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── Pourquoi pas l'API officielle Riot ? ──────────────────────────────
 * L'API officielle (developer.riotgames.com) n'expose PAS le rang compétitif
 * d'un joueur arbitraire :
 *   • `val-ranked-v1`  → uniquement le leaderboard Radiant/Immortel ;
 *   • `val-match-v1`   → clé « production » accordée au cas par cas, et ne
 *                        renvoie pas le tier courant d'un joueur ;
 *   • `account-v1`     → seulement puuid / gameName / tagLine.
 *
 * Le seul chemin réaliste pour « pseudo#TAG → Or 2, 54 RR » est donc une API
 * communautaire. Ce module parle à **HenrikDev** (https://api.henrikdev.xyz),
 * de loin la plus utilisée et la plus stable ; la clé est gratuite et se
 * demande sur leur Discord (https://discord.gg/henrikdev). Sans clé, le bot
 * fonctionne toujours : les rangs restent saisis à la main, jamais inventés.
 *
 * `RIOT_API_BASE` permet de pointer une autre implémentation compatible
 * (instance auto-hébergée, proxy interne…) sans toucher au code.
 *
 * ── Ce que ce module garantit ────────────────────────────────────────
 *   • Aucune exception qui remonte : toute erreur devient un résultat typé
 *     `{ ok: false, code, message }` — le bot ne crashe jamais sur l'API.
 *   • Un seul appel HTTP à la fois, espacé (file d'attente) : pas de 429.
 *   • Cache mémoire avec TTL + cache négatif : cliquer 10 fois sur
 *     « Rejoindre » ne déclenche pas 10 requêtes.
 *   • Dédoublonnage : deux demandes simultanées sur le même joueur
 *     partagent la même requête HTTP.
 */

const settings = require("./settings");

const DEFAULT_BASE = "https://api.henrikdev.xyz";

// HenrikDev : ~30 requêtes/minute sur une clé gratuite. On s'impose un
// intervalle confortable — les rangs sont mis en cache, ça ne se voit pas.
const MIN_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 8_000;

// TTL du cache. Le rang bouge après une partie classée : 30 min est un bon
// compromis entre fraîcheur et nombre d'appels.
const ACCOUNT_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 5 * 60 * 1000;

const REGIONS = ["eu", "na", "ap", "kr", "latam", "br"];

// ─────────────────────────────── ÉTAT ───────────────────────────────

/** @type {Map<string, {value: any, expiresAt: number}>} */
const cache = new Map();
/** @type {Map<string, Promise<any>>} requêtes en vol, pour dédoublonner */
const inflight = new Map();

// Statistiques exposées dans le panneau (🎯 Rangs → diagnostic).
const stats = { calls: 0, hits: 0, errors: 0, rateLimited: 0, lastError: null, lastCallAt: null };

let queue = Promise.resolve();
let lastCallAt = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** File d'attente : les appels HTTP sont sérialisés ET espacés. */
function schedule(task) {
  const run = queue.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    return task();
  });
  queue = run.then(() => {}, () => {});
  return run;
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  stats.hits += 1;
  return entry.value;
}

function cacheSet(key, value, ttlMs) {
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

/** Vide le cache d'un joueur (utilisé par « Rafraîchir mon rang »). */
function invalidate(name, tag) {
  const needle = `${String(name).toLowerCase()}#${String(tag).toLowerCase()}`;
  for (const key of [...cache.keys()]) {
    if (key.includes(needle)) cache.delete(key);
  }
}

// ────────────────────────── CONFIGURATION ──────────────────────────

/** Clé courante : celle du panneau si renseignée, sinon celle du .env. */
function apiKey() {
  const fromPanel = settings.get("riotApiKey");
  return (fromPanel || process.env.RIOT_API_KEY || process.env.VALORANT_API_KEY || "").trim();
}

const baseUrl = () => (process.env.RIOT_API_BASE || DEFAULT_BASE).replace(/\/+$/, "");

/** L'API est-elle utilisable ? (clé présente et récupération auto activée) */
const isConfigured = () => Boolean(apiKey());
const isEnabled = () => Boolean(settings.get("autoRank")) && isConfigured();

const defaultRegion = () => {
  const region = String(settings.get("riotRegion") || "eu").toLowerCase();
  return REGIONS.includes(region) ? region : "eu";
};

/** Clé masquée pour l'affichage dans le panneau — jamais la valeur en clair. */
function maskedKey() {
  const key = apiKey();
  if (!key) return null;
  return key.length <= 8 ? "••••" : `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

// ──────────────────────────── REQUÊTE HTTP ────────────────────────────

const fail = (code, message) => {
  stats.errors += 1;
  stats.lastError = { code, message, at: Date.now() };
  return { ok: false, code, message };
};

/**
 * Un appel HTTP, avec timeout, gestion du 429 et une seule tentative de reprise.
 * Ne lève jamais : renvoie toujours `{ok}` ou `{ok:false, code, message}`.
 */
async function request(path, { retry = true } = {}) {
  const key = apiKey();
  if (!key) return fail("no_key", "Aucune clé d'API renseignée.");

  stats.calls += 1;
  stats.lastCallAt = Date.now();

  let response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      headers: { Authorization: key, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return fail(
      timedOut ? "timeout" : "network",
      timedOut ? "L'API de rangs n'a pas répondu à temps." : `Réseau injoignable : ${error.message}`,
    );
  }

  // ---- Quota dépassé : on respecte le Retry-After, une seule fois ----
  if (response.status === 429) {
    stats.rateLimited += 1;
    const after = Math.min(Number(response.headers.get("retry-after")) || 5, 10);
    if (!retry) return fail("rate_limited", "Quota de l'API de rangs atteint, réessaie dans un instant.");
    await sleep(after * 1000);
    return schedule(() => request(path, { retry: false }));
  }

  if (response.status === 401 || response.status === 403) {
    return fail("bad_key", "Clé d'API refusée (invalide ou expirée).");
  }
  if (response.status === 404) {
    return fail("not_found", "Ce Riot ID est introuvable (pseudo, tag ou région).");
  }
  if (response.status >= 500) {
    if (!retry) return fail("upstream", `L'API de rangs est en panne (HTTP ${response.status}).`);
    await sleep(1_000);
    return schedule(() => request(path, { retry: false }));
  }
  if (!response.ok) {
    return fail("http", `Réponse inattendue de l'API (HTTP ${response.status}).`);
  }

  try {
    const body = await response.json();
    return { ok: true, data: body?.data ?? body };
  } catch {
    return fail("parse", "Réponse illisible de l'API de rangs.");
  }
}

/** Dédoublonnage : deux joueurs qui demandent le même compte = une requête. */
function once(key, factory) {
  const pending = inflight.get(key);
  if (pending) return pending;

  const promise = factory().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

// ───────────────────────────── ENDPOINTS ─────────────────────────────

const encode = (value) => encodeURIComponent(String(value).trim());

/**
 * Vérifie l'existence d'un Riot ID et récupère puuid + région.
 * C'est cet appel qui valide une liaison de compte.
 *
 * @returns {Promise<{ok:true, account:{puuid,name,tag,region,level}}|{ok:false,code,message}>}
 */
async function fetchAccount(name, tag) {
  const cacheKey = `account:${name.toLowerCase()}#${tag.toLowerCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  return once(cacheKey, async () => {
    const result = await schedule(() => request(`/valorant/v2/account/${encode(name)}/${encode(tag)}`));
    if (!result.ok) {
      // Un compte inexistant se met aussi en cache : inutile de re-frapper
      // l'API à chaque clic sur un pseudo mal orthographié.
      if (result.code === "not_found") cacheSet(cacheKey, result, NEGATIVE_TTL_MS);
      return result;
    }

    const data = result.data || {};
    const account = {
      puuid: data.puuid || null,
      name: data.name || name,
      tag: data.tag || tag,
      region: String(data.region || defaultRegion()).toLowerCase(),
      level: Number.isFinite(data.account_level) ? data.account_level : null,
    };
    return cacheSet(cacheKey, { ok: true, account }, ACCOUNT_TTL_MS);
  });
}

/**
 * Rang compétitif courant.
 *
 * La forme de la réponse varie selon la version de l'API : on lit
 * défensivement `current` (v3) puis `current_data` (v2), et on préfère
 * toujours le `tier` numérique au libellé, qui dépend de la langue.
 *
 * @returns {Promise<{ok:true, mmr:{tierId,tierName,rr,elo,games}}|{ok:false,code,message}>}
 */
async function fetchMmr({ name, tag, region }) {
  const zone = REGIONS.includes(String(region).toLowerCase()) ? String(region).toLowerCase() : defaultRegion();
  const cacheKey = `mmr:${zone}:${name.toLowerCase()}#${tag.toLowerCase()}`;

  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  return once(cacheKey, async () => {
    const result = await schedule(() => request(`/valorant/v3/mmr/${zone}/pc/${encode(name)}/${encode(tag)}`));
    if (!result.ok) {
      if (result.code === "not_found") cacheSet(cacheKey, result, NEGATIVE_TTL_MS);
      return result;
    }

    const data = result.data || {};
    const current = data.current || data.current_data || {};

    const tierId = current.tier?.id ?? current.currenttier ?? null;
    const tierName = current.tier?.name ?? current.currenttierpatched ?? null;
    const rr = current.rr ?? current.ranking_in_tier ?? null;

    // Ni tier ni libellé : le compte existe mais n'a pas de données classées
    // (jamais joué en compétitif, ou profil masqué). Ce n'est pas une erreur.
    const mmr = {
      tierId: Number.isFinite(Number(tierId)) ? Number(tierId) : null,
      tierName: tierName || null,
      rr: Number.isFinite(Number(rr)) ? Number(rr) : null,
      elo: Number.isFinite(Number(current.elo)) ? Number(current.elo) : null,
      games: Number.isFinite(Number(current.games_needed_for_rating)) ? Number(current.games_needed_for_rating) : null,
    };

    const ttl = Math.max(1, Number(settings.get("rankCacheMinutes")) || 30) * 60 * 1000;
    return cacheSet(cacheKey, { ok: true, mmr, region: zone }, ttl);
  });
}

/** État de l'intégration, pour le panneau de contrôle. */
function status() {
  return {
    configured: isConfigured(),
    enabled: isEnabled(),
    base: baseUrl(),
    key: maskedKey(),
    region: defaultRegion(),
    cacheEntries: cache.size,
    ...stats,
  };
}

module.exports = {
  REGIONS, DEFAULT_BASE,
  isConfigured, isEnabled, defaultRegion, maskedKey, baseUrl,
  fetchAccount, fetchMmr, invalidate, status,
};
