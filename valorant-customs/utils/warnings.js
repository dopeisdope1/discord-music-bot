/**
 * ═══════════════════════════════════════════════════════════════════════
 *  SYSTÈME ANTI-ABSENT — le cœur du bot
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Cycle complet :
 *   1. L'avertissement part TOUT SEUL au lancement de la partie pour quiconque
 *      n'est pas dans le vocal de son équipe (voir utils/automation.js).
 *      Il reste déclenchable à la main : commande `avertir` ou panneau.
 *   2. Le bot ping le joueur : « Tu as 1 minute pour rejoindre le vocal… ».
 *   3. Un timer de 60 s démarre, visible en direct dans le panneau de partie.
 *   4a. Le joueur rejoint le vocal → l'avertissement est annulé immédiatement
 *       (voir events/voiceStateUpdate.js), sans attendre la fin du timer.
 *   4b. Sinon → retrait automatique, et un message public annonce que la
 *       personne n'est pas là avec un bouton **Prendre sa place**.
 *
 * Les timers sont conservés en mémoire MAIS les échéances sont persistées :
 * après un redémarrage, restoreTimers() ré-arme tout (ou tranche
 * immédiatement si le délai est déjà écoulé).
 */

const config = require("../config");
const store = require("./store");
const { logEvent } = require("./logger");
const {
  findTeam, teamIsFull, removePlayer, addToTeam,
  refreshMatchMessage, announce, fetchMatchChannel,
} = require("./matches");
const {
  buildWarningEmbed, buildFreeSpotEmbed, buildClaimComponents,
  infoEmbed, successEmbed,
} = require("./embeds");
const { isInTeamVoice, syncTeamPermissions, moveToTeamChannel } = require("./voice");
const settings = require("./settings");

// setTimeout plafonne à ~24,8 jours : on borne pour éviter un déclenchement immédiat.
const MAX_TIMEOUT = 2 ** 31 - 1;

/** @type {Map<string, NodeJS.Timeout>} clé `matchId:userId` */
const warnTimers = new Map();
const warnKey = (matchId, userId) => `${matchId}:${userId}`;

function clearTimer(map, key) {
  const timer = map.get(key);
  if (timer) clearTimeout(timer);
  map.delete(key);
}

// ═══════════════════════════ AVERTISSEMENTS ═══════════════════════════

/**
 * Démarre un avertissement contre un joueur.
 * Les droits (hôte/staff) sont vérifiés par l'appelant.
 *
 * @returns {Promise<{ok: boolean, error?: string, teamNo?: number, deadline?: number}>}
 */
async function startWarning(client, match, targetId, issuerId, { notify = true } = {}) {
  if (match.status === "ended") return { ok: false, error: "Cette partie est terminée." };

  const teamNo = findTeam(match, targetId);
  if (!teamNo) return { ok: false, error: "Ce joueur n'est dans aucune des deux équipes." };
  if (match.warnings[targetId]) {
    const remaining = Math.max(0, Math.round((match.warnings[targetId].deadline - Date.now()) / 1000));
    return { ok: false, error: `Ce joueur est déjà sous avertissement (${remaining} s restantes).` };
  }

  // Court-circuit : inutile d'avertir quelqu'un déjà présent dans le vocal.
  const guild = await client.guilds.fetch(match.guildId).catch(() => null);
  if (guild && (await isInTeamVoice(guild, match, teamNo, targetId))) {
    return { ok: false, error: "Ce joueur est déjà connecté au salon vocal de son équipe." };
  }

  const deadline = Date.now() + settings.get("warnMs");
  match.warnings[targetId] = { deadline, teamNo, issuerId, noticeId: null };
  store.save();

  // Un des rares messages du bot qui ping réellement : l'avertissement doit se
  // voir. `notify: false` sert à l'avertissement automatique du lancement, qui
  // poste un seul message groupé pour tous les absents (voir automation.js).
  if (notify) {
    const notice = await announce(client, match, {
      content: `<@${targetId}>`,
      embeds: [buildWarningEmbed(match, targetId, teamNo, deadline)],
      mentionUsers: [targetId],
    });
    if (notice) match.warnings[targetId].noticeId = notice.id;
  }
  store.save();

  scheduleWarning(client, match.id, targetId, deadline);
  await refreshMatchMessage(client, match);

  logEvent(client, "warn", {
    matchId: match.id,
    description: `<@${targetId}> (Équipe ${teamNo}) averti par <@${issuerId}> — ${Math.round(settings.get("warnMs") / 1000)} s pour rejoindre le vocal.`,
  });

  return { ok: true, teamNo, deadline };
}

function scheduleWarning(client, matchId, targetId, deadline) {
  const key = warnKey(matchId, targetId);
  clearTimer(warnTimers, key);

  const delay = Math.min(Math.max(deadline - Date.now(), 0), MAX_TIMEOUT);
  const timer = setTimeout(() => {
    warnTimers.delete(key);
    resolveWarning(client, matchId, targetId).catch((error) =>
      console.error(`[warnings] Résolution impossible (#${matchId}) :`, error));
  }, delay);
  warnTimers.set(key, timer);
}

/**
 * Fin du timer : le joueur est-il dans le vocal de son équipe ?
 * Non → retrait automatique + proposition de la place à la liste d'attente.
 */
async function resolveWarning(client, matchId, targetId) {
  const match = store.getMatch(matchId);
  if (!match) return;
  const warning = match.warnings[targetId];
  if (!warning) return; // déjà annulé entre-temps

  clearTimer(warnTimers, warnKey(matchId, targetId));
  delete match.warnings[targetId];
  store.save();

  if (match.status === "ended") return;

  const guild = await client.guilds.fetch(match.guildId).catch(() => null);
  const present = guild ? await isInTeamVoice(guild, match, warning.teamNo, targetId) : false;

  if (present) {
    // Cas normal quand le joueur arrive pile à la fin du délai.
    await refreshMatchMessage(client, match);
    await announce(client, match, {
      embeds: [successEmbed(`<@${targetId}> a rejoint le vocal à temps — il garde sa place.`)],
    });
    logEvent(client, "warn", { matchId: match.id, description: `<@${targetId}> a répondu à temps.` });
    return;
  }

  // ---- Absent : retrait de l'équipe ----
  removePlayer(match, targetId);
  store.save();
  await refreshMatchMessage(client, match);

  if (guild) await syncTeamPermissions(guild, match, warning.teamNo);

  logEvent(client, "kick", {
    matchId: match.id,
    description: `<@${targetId}> retiré de l'Équipe ${warning.teamNo} pour absence (avertissement expiré).`,
  });

  // Le message d'absence EST la proposition : un bouton « Prendre sa place ».
  await offerSpot(client, match, warning.teamNo, { absentId: targetId });
}

/**
 * Annule un avertissement en cours (joueur revenu en vocal, partie terminée,
 * annulation manuelle…).
 */
async function cancelWarning(client, match, targetId, { reason = null, silent = false } = {}) {
  const warning = match.warnings?.[targetId];
  if (!warning) return false;

  clearTimer(warnTimers, warnKey(match.id, targetId));
  delete match.warnings[targetId];
  store.save();
  await refreshMatchMessage(client, match);

  if (!silent) {
    await announce(client, match, {
      embeds: [successEmbed(reason || `Avertissement annulé pour <@${targetId}>.`)],
    });
    logEvent(client, "warn", {
      matchId: match.id,
      description: `Avertissement annulé pour <@${targetId}>${reason ? ` — ${reason}` : ""}.`,
    });
  }
  return true;
}

/** Coupe tous les timers d'une partie (fin de partie / suppression). */
function clearMatchTimers(match) {
  for (const userId of Object.keys(match.warnings || {})) clearTimer(warnTimers, warnKey(match.id, userId));
}

// ═════════════════ PLACE LIBRE : « PRENDRE SA PLACE » ═════════════════

/**
 * Annonce une place libre avec un bouton **Prendre sa place**.
 *
 * Pas de proposition privée ni de confirmation à rallonge : un message public,
 * un clic, c'est réglé. La liste d'attente garde une priorité — pendant les
 * premières secondes, seuls ses membres peuvent cliquer — puis la place s'ouvre
 * à tout le monde. Si l'attribution automatique est activée, le premier de la
 * liste est ajouté directement, sans clic.
 *
 * @param {{absentId?: string}} options absentId = le joueur qui vient d'être
 *        retiré, pour l'annoncer dans le même message.
 */
async function offerSpot(client, match, teamNo, { absentId = null } = {}) {
  if (match.status === "ended" || teamIsFull(match, teamNo)) return;

  // Attribution automatique : personne n'a rien à cliquer.
  if (settings.get("autoPromote") && match.waitlist.length) {
    await promoteCandidate(client, match, teamNo, match.waitlist[0], "automatiquement");
    return;
  }

  // Priorité à la liste d'attente pendant ce laps de temps.
  const reservedUntil = match.waitlist.length ? Date.now() + settings.get("promoteMs") : 0;
  match.offers[teamNo] = { reservedUntil, reserved: [...match.waitlist], messageId: null };
  store.save();

  const lines = [];
  if (absentId) lines.push(`⛔ <@${absentId}> **n'est pas là** — il a été retiré de l'**Équipe ${teamNo}**.`);
  else lines.push(`🎟️ Une place s'est libérée en **Équipe ${teamNo}**.`);
  lines.push("", "**Clique ci-dessous pour prendre sa place.**");
  if (reservedUntil) {
    lines.push("", `-# Réservé à la liste d'attente jusqu'à <t:${Math.floor(reservedUntil / 1000)}:T>, puis ouvert à tous.`);
  }

  const message = await announce(client, match, {
    // On ping l'absent et la liste d'attente : ce sont eux les concernés.
    content: [absentId ? `<@${absentId}>` : null, ...match.waitlist.slice(0, 5).map((id) => `<@${id}>`)]
      .filter(Boolean).join(" ") || undefined,
    embeds: [buildFreeSpotEmbed(match, teamNo, absentId, reservedUntil)],
    components: buildClaimComponents(match, teamNo),
    mentionUsers: [absentId, ...match.waitlist.slice(0, 5)].filter(Boolean),
  });

  match.offers[teamNo].messageId = message?.id || null;
  store.save();
}

/**
 * Quelqu'un clique sur « Prendre sa place ».
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function claimSpot(client, match, teamNo, userId) {
  if (match.status === "ended") return { ok: false, error: "Cette partie est terminée." };
  if (teamIsFull(match, teamNo)) return { ok: false, error: `L'**Équipe ${teamNo}** est déjà complète.` };
  if (findTeam(match, userId) === teamNo) return { ok: false, error: `Tu es déjà dans l'**Équipe ${teamNo}**.` };

  const offer = match.offers?.[teamNo];
  // Fenêtre de priorité : la liste d'attente d'abord, tout le monde ensuite.
  if (offer?.reservedUntil > Date.now() && offer.reserved?.length && !offer.reserved.includes(userId)) {
    return {
      ok: false,
      error: `Cette place est réservée à la liste d'attente jusqu'à <t:${Math.floor(offer.reservedUntil / 1000)}:T>. Réessaie après.`,
    };
  }

  delete match.offers[teamNo];
  store.save();

  await promoteCandidate(client, match, teamNo, userId, "en cliquant");
  await closeOfferMessage(client, match, offer, `✅ <@${userId}> a pris la place en **Équipe ${teamNo}**.`);
  return { ok: true };
}

/** Ajout effectif dans l'équipe + synchronisation vocale. */
async function promoteCandidate(client, match, teamNo, candidateId, howLabel) {
  addToTeam(match, candidateId, teamNo);
  store.save();
  await refreshMatchMessage(client, match);

  await announce(client, match, {
    content: `<@${candidateId}>`,
    embeds: [successEmbed(`<@${candidateId}> rejoint l'**Équipe ${teamNo}** ${howLabel} — bienvenue !`)],
    mentionUsers: [candidateId],
  });

  const guild = await client.guilds.fetch(match.guildId).catch(() => null);
  if (guild) {
    await syncTeamPermissions(guild, match, teamNo);
    // Partie déjà lancée : on place le remplaçant tout de suite, et s'il n'est
    // pas en vocal il hérite du même avertissement que les autres.
    if (match.status === "live") {
      const moved = await moveToTeamChannel(guild, match, teamNo, candidateId);
      if (!moved.moved && settings.get("autoWarn")) {
        await startWarning(client, match, candidateId, client.user.id);
      }
    }
  }

  logEvent(client, "promote", {
    matchId: match.id,
    description: `<@${candidateId}> ajouté à l'Équipe ${teamNo} (${howLabel}).`,
  });
}

/** Désactive le bouton du message de place libre et affiche le verdict. */
async function closeOfferMessage(client, match, offer, verdict) {
  if (!offer?.messageId) return;
  const channel = await fetchMatchChannel(client, match);
  if (!channel) return;
  try {
    const message = await channel.messages.fetch(offer.messageId);
    await message.edit({ content: null, embeds: [infoEmbed(verdict)], components: [] });
  } catch {
    // Message supprimé entre-temps : sans conséquence.
  }
}


// ═══════════════════════ REPRISE APRÈS REDÉMARRAGE ═══════════════════════

/**
 * Ré-arme tous les timers persistés. Appelé une fois le bot prêt.
 * Les échéances déjà dépassées sont traitées immédiatement : un redémarrage
 * ne doit jamais faire « oublier » un avertissement en cours.
 */
async function restoreTimers(client) {
  let restored = 0;

  for (const match of store.allMatches()) {
    if (match.status === "ended") continue;
    for (const [userId, warning] of Object.entries(match.warnings || {})) {
      scheduleWarning(client, match.id, userId, warning.deadline);
      restored += 1;
    }
  }

  if (restored) console.log(`[warnings] Reprise : ${restored} avertissement(s) ré-armé(s).`);
}

module.exports = {
  startWarning, cancelWarning, resolveWarning, clearMatchTimers,
  offerSpot, claimSpot,
  restoreTimers,
};
