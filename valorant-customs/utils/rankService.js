/**
 * ═══════════════════════════════════════════════════════════════════════
 *  PROFILS & RANGS — liaison Riot ID ↔ Discord
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Flux voulu : le joueur ne tape **jamais** son rang.
 *
 *   Clic « Rejoindre »
 *        ↓
 *   Pas encore de compte lié → modale « Ton Riot ID » (une seule fois)
 *        ↓
 *   Validation auprès de l'API (le compte existe ? quelle région ?)
 *        ↓
 *   Récupération du rang + RR, mise en cache
 *        ↓
 *   Toutes les parties suivantes le récupèrent toutes seules.
 *
 * Trois sources possibles pour un rang, jamais mélangées :
 *   • `api`     — récupéré automatiquement, affiché avec son RR ;
 *   • `manual`  — saisi par le joueur (API absente ou compte introuvable) ;
 *   • `unknown` — rien de fiable : le bot affiche « ❔ Rang inconnu ».
 *
 * Aucun rang n'est jamais inventé ni deviné.
 */

const store = require("./store");
const riot = require("./riot");
const settings = require("./settings");
const {
  UNRANKED, formatRank, rankFromTierId, rankFromTierName, strength, parseRank,
} = require("./ranks");

/** "Snow#EUW" → { name: "Snow", tag: "EUW" }. Tolère les espaces parasites. */
function parseRiotId(input) {
  if (!input) return null;
  const raw = String(input).trim().replace(/^@/, "");
  const hash = raw.lastIndexOf("#");
  if (hash <= 0 || hash === raw.length - 1) return null;

  const name = raw.slice(0, hash).trim();
  const tag = raw.slice(hash + 1).trim();

  // Riot : pseudo 3-16 caractères, tag 3-5. On reste tolérant (l'API tranchera)
  // mais on refuse les saisies manifestement absurdes.
  if (!name || name.length > 20 || !tag || tag.length > 6 || /\s/.test(tag)) return null;
  return { name, tag };
}

const riotIdOf = (name, tag) => `${name}#${tag}`;

/** Le rang en cache est-il encore frais ? */
function isFresh(profile) {
  if (!profile?.syncedAt) return false;
  const ttl = Math.max(1, Number(settings.get("rankCacheMinutes")) || 30) * 60 * 1000;
  return Date.now() - profile.syncedAt < ttl;
}

// ─────────────────────────── RÉCUPÉRATION ───────────────────────────

/**
 * Interroge l'API pour un couple pseudo/tag.
 * @returns {Promise<{ok: true, rank, rr, region, name, tag, puuid}|{ok: false, code, message}>}
 */
async function lookup({ name, tag, region = null }) {
  const account = await riot.fetchAccount(name, tag);
  if (!account.ok) return account;

  const zone = region || account.account.region;
  const mmr = await riot.fetchMmr({ name: account.account.name, tag: account.account.tag, region: zone });
  if (!mmr.ok) {
    // Le compte existe mais le rang n'est pas lisible : on garde quand même la
    // liaison (puuid, région), c'est déjà utile pour la prochaine tentative.
    return {
      ok: false,
      code: mmr.code,
      message: mmr.message,
      account: { ...account.account, region: zone },
    };
  }

  // Le `tier` numérique prime : il ne dépend pas de la langue de l'API.
  const rank = mmr.mmr.tierId !== null
    ? rankFromTierId(mmr.mmr.tierId)
    : (mmr.mmr.tierName ? rankFromTierName(mmr.mmr.tierName) : { ...UNRANKED });

  return {
    ok: true,
    puuid: account.account.puuid,
    name: account.account.name,
    tag: account.account.tag,
    region: mmr.region || zone,
    rank,
    rr: mmr.mmr.rr,
  };
}

/**
 * Lie (ou re-lie) un compte Riot à un utilisateur Discord.
 *
 * @param {string} userId
 * @param {string} riotIdInput   "Snow#EUW"
 * @param {{manualRank?: string}} options rang de secours saisi à la main,
 *        utilisé uniquement si l'API n'est pas disponible.
 * @returns {Promise<{ok: boolean, profile?: object, code?: string, message?: string, warning?: string}>}
 */
async function linkAccount(userId, riotIdInput, { manualRank = null } = {}) {
  const parsed = parseRiotId(riotIdInput);
  if (!parsed) {
    return { ok: false, code: "bad_format", message: "Format attendu : `Pseudo#TAG` — par exemple `Snow#EUW`." };
  }

  const fallbackRank = manualRank ? parseRank(manualRank) : null;
  if (manualRank && !fallbackRank) {
    return { ok: false, code: "bad_rank", message: `Rang non reconnu : \`${manualRank}\`.` };
  }

  // ---- API désactivée ou non configurée : liaison « à l'ancienne » ----
  if (!riot.isEnabled()) {
    const profile = store.setProfile(userId, {
      riotId: riotIdOf(parsed.name, parsed.tag),
      riotName: parsed.name,
      riotTag: parsed.tag,
      puuid: null,
      region: null,
      rank: fallbackRank || { ...UNRANKED },
      rr: null,
      source: fallbackRank ? "manual" : "unknown",
      syncedAt: null,
    });
    return {
      ok: true,
      profile,
      warning: fallbackRank
        ? null
        : "La récupération automatique des rangs est désactivée : ton rang restera **inconnu** tant qu'il n'est pas saisi.",
    };
  }

  // ---- Chemin normal : validation + rang réel ----
  const result = await lookup(parsed);

  if (!result.ok) {
    const account = result.account || null;
    const profile = store.setProfile(userId, {
      riotId: riotIdOf(account?.name || parsed.name, account?.tag || parsed.tag),
      riotName: account?.name || parsed.name,
      riotTag: account?.tag || parsed.tag,
      puuid: account?.puuid || null,
      region: account?.region || null,
      rank: fallbackRank || { ...UNRANKED },
      rr: null,
      source: fallbackRank ? "manual" : "unknown",
      syncedAt: null,
    });

    // Riot ID franchement inexistant sans rang de secours : on le dit, mais on
    // ne bloque pas le joueur — il reste inscriptible avec « rang inconnu ».
    return {
      ok: true,
      profile,
      warning: `${result.message} Ton rang s'affichera comme **inconnu** ; réessaie plus tard avec \`${settings.get("prefix")}rang\`.`,
    };
  }

  const profile = store.setProfile(userId, {
    riotId: riotIdOf(result.name, result.tag),
    riotName: result.name,
    riotTag: result.tag,
    puuid: result.puuid,
    region: result.region,
    rank: result.rank,
    rr: result.rr,
    source: "api",
    syncedAt: Date.now(),
  });

  return { ok: true, profile };
}

/**
 * Rafraîchit le rang d'un joueur déjà lié.
 *
 * @param {string} userId
 * @param {{force?: boolean}} options force = ignore le cache et le TTL
 * @returns {Promise<{ok: boolean, profile?: object, changed?: boolean, code?: string, message?: string}>}
 */
async function refreshRank(userId, { force = false } = {}) {
  const profile = store.getProfile(userId);
  if (!profile?.riotId) return { ok: false, code: "no_profile", message: "Aucun compte Riot lié." };
  if (!riot.isEnabled()) return { ok: false, code: "disabled", message: "Récupération automatique désactivée." };
  if (!force && isFresh(profile)) return { ok: true, profile, changed: false };

  const parsed = profile.riotName && profile.riotTag
    ? { name: profile.riotName, tag: profile.riotTag }
    : parseRiotId(profile.riotId);
  if (!parsed) return { ok: false, code: "bad_format", message: "Riot ID enregistré illisible." };

  if (force) riot.invalidate(parsed.name, parsed.tag);

  const result = await lookup({ ...parsed, region: profile.region });
  if (!result.ok) return { ok: false, code: result.code, message: result.message };

  const changed = profile.rank?.key !== result.rank.key
    || profile.rank?.division !== result.rank.division
    || profile.rr !== result.rr;

  const updated = store.updateProfile(userId, {
    riotId: riotIdOf(result.name, result.tag),
    riotName: result.name,
    riotTag: result.tag,
    puuid: result.puuid,
    region: result.region,
    rank: result.rank,
    rr: result.rr,
    source: "api",
    syncedAt: Date.now(),
  });

  return { ok: true, profile: updated, changed };
}

/**
 * Rafraîchit le rang « au mieux » : silencieux, ne lève rien, ne bloque rien.
 * Appelé à chaque inscription — le panneau se met à jour quand la réponse
 * arrive, sans jamais retarder le clic du joueur.
 *
 * @returns {Promise<boolean>} true si le profil affiché a changé.
 */
async function ensureFreshRank(userId) {
  try {
    const result = await refreshRank(userId);
    return Boolean(result.ok && result.changed);
  } catch (error) {
    console.error(`[rangs] Rafraîchissement impossible pour ${userId} :`, error.message);
    return false;
  }
}

// ──────────────────────────── AFFICHAGE ────────────────────────────

/** "💎 Diamant 2 · 54 RR", "🟨 Or 1" ou "❔ Rang inconnu". */
function formatProfileRank(profile) {
  if (!profile || !profile.rank || profile.source === "unknown" || profile.rank.key === "unranked") {
    return profile?.rank?.key === "unranked" && profile?.source === "api"
      ? formatRank(profile.rank)          // vraiment non classé, l'API l'a dit
      : "❔ Rang inconnu";
  }
  return formatRank(profile.rank, { rr: profile.source === "api" ? profile.rr : null });
}

/** Petit marqueur de provenance, affiché en texte réduit dans les panneaux. */
const sourceLabel = (profile) => ({
  api: "rang vérifié",
  manual: "rang déclaré",
  unknown: "rang non renseigné",
}[profile?.source] || "rang déclaré");

/** Force d'un joueur pour l'équilibrage — null si son rang est inconnu. */
function strengthOf(userId) {
  const profile = store.getProfile(userId);
  if (!profile || profile.source === "unknown") return null;
  return strength(profile.rank, profile.source === "api" ? profile.rr : null);
}

module.exports = {
  parseRiotId, riotIdOf, isFresh,
  linkAccount, refreshRank, ensureFreshRank, lookup,
  formatProfileRank, sourceLabel, strengthOf,
};
