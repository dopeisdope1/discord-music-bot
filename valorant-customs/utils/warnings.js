/**
 * ═══════════════════════════════════════════════════════════════════════
 *  SYSTÈME ANTI-ABSENT — le cœur du bot
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Cycle complet :
 *   1. L'hôte (ou le staff) avertit un joueur : /avertir ou bouton « Avertir ».
 *   2. Le bot ping le joueur : « Tu as 1 minute pour rejoindre le vocal… ».
 *   3. Un timer de 60 s démarre, visible en direct dans l'embed de la partie.
 *   4a. Le joueur rejoint le vocal → l'avertissement est annulé immédiatement
 *       (voir events/voiceStateUpdate.js), sans attendre la fin du timer.
 *   4b. Sinon → retrait automatique de l'équipe, message public, et la place
 *       est proposée au premier de la liste d'attente (avec confirmation).
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
  buildWarningEmbed, buildOfferEmbed, buildOfferComponents,
  infoEmbed, successEmbed,
} = require("./embeds");
const { isInTeamVoice, syncTeamPermissions, moveToTeamChannel } = require("./voice");

// setTimeout plafonne à ~24,8 jours : on borne pour éviter un déclenchement immédiat.
const MAX_TIMEOUT = 2 ** 31 - 1;

/** @type {Map<string, NodeJS.Timeout>} clé `matchId:userId` */
const warnTimers = new Map();
/** @type {Map<string, NodeJS.Timeout>} clé `matchId:teamNo` */
const offerTimers = new Map();

const warnKey = (matchId, userId) => `${matchId}:${userId}`;
const offerKey = (matchId, teamNo) => `${matchId}:${teamNo}`;

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
async function startWarning(client, match, targetId, issuerId) {
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

  const deadline = Date.now() + config.timings.warnMs;
  match.warnings[targetId] = { deadline, teamNo, issuerId, noticeId: null };
  store.save();

  // Le SEUL message du bot qui ping réellement : l'avertissement doit se voir.
  const notice = await announce(client, match, {
    content: `<@${targetId}>`,
    embeds: [buildWarningEmbed(match, targetId, teamNo, deadline)],
    mentionUsers: [targetId],
  });
  if (notice) match.warnings[targetId].noticeId = notice.id;
  store.save();

  scheduleWarning(client, match.id, targetId, deadline);
  await refreshMatchMessage(client, match);

  logEvent(client, "warn", {
    matchId: match.id,
    description: `<@${targetId}> (Équipe ${teamNo}) averti par <@${issuerId}> — ${Math.round(config.timings.warnMs / 1000)} s pour rejoindre le vocal.`,
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

  await announce(client, match, {
    content: `<@${targetId}> a été retiré pour absence. Une place est libre !`,
    embeds: [
      infoEmbed(`⛔ **Équipe ${warning.teamNo}** — <@${targetId}> n'a pas rejoint le salon vocal dans le délai imparti.`),
    ],
    mentionUsers: [targetId],
  });

  if (guild) await syncTeamPermissions(guild, match, warning.teamNo);

  logEvent(client, "kick", {
    matchId: match.id,
    description: `<@${targetId}> retiré de l'Équipe ${warning.teamNo} pour absence (avertissement expiré).`,
  });

  await offerSpot(client, match, warning.teamNo);
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
  for (const teamNo of Object.keys(match.offers || {})) clearTimer(offerTimers, offerKey(match.id, teamNo));
}

// ═════════════════════ LISTE D'ATTENTE : PROPOSITION ═════════════════════

/**
 * Propose la place libérée au premier de la liste d'attente.
 * Par défaut avec confirmation (boutons) ; AUTO_PROMOTE=true l'ajoute direct.
 */
async function offerSpot(client, match, teamNo) {
  if (match.status === "ended" || teamIsFull(match, teamNo)) return;
  if (match.offers?.[teamNo]) return; // une proposition est déjà en cours

  if (!match.waitlist.length) {
    await announce(client, match, {
      embeds: [infoEmbed(`${config.emojis.waitlist} Aucun joueur en liste d'attente : la place en **Équipe ${teamNo}** reste ouverte.`)],
    });
    return;
  }

  const candidateId = match.waitlist[0];

  if (config.behaviour.autoPromote) {
    await promoteCandidate(client, match, teamNo, candidateId, "automatiquement");
    return;
  }

  const deadline = Date.now() + config.timings.promoteMs;
  const message = await announce(client, match, {
    content: `<@${candidateId}>`,
    embeds: [buildOfferEmbed(match, teamNo, candidateId, deadline)],
    components: buildOfferComponents(match, teamNo, candidateId),
    mentionUsers: [candidateId],
  });

  match.offers[teamNo] = { userId: candidateId, deadline, messageId: message?.id || null };
  store.save();
  scheduleOfferExpiry(client, match.id, teamNo, deadline);
}

function scheduleOfferExpiry(client, matchId, teamNo, deadline) {
  const key = offerKey(matchId, teamNo);
  clearTimer(offerTimers, key);

  const delay = Math.min(Math.max(deadline - Date.now(), 0), MAX_TIMEOUT);
  const timer = setTimeout(() => {
    offerTimers.delete(key);
    expireOffer(client, matchId, teamNo).catch((error) =>
      console.error(`[warnings] Expiration de proposition impossible (#${matchId}) :`, error));
  }, delay);
  offerTimers.set(key, timer);
}

/** Pas de réponse dans le délai : le joueur sort de la liste, au suivant. */
async function expireOffer(client, matchId, teamNo) {
  const match = store.getMatch(matchId);
  const offer = match?.offers?.[teamNo];
  if (!match || !offer) return;

  delete match.offers[teamNo];
  match.waitlist = match.waitlist.filter((id) => id !== offer.userId);
  store.save();

  await closeOfferMessage(client, match, offer, `⏱️ <@${offer.userId}> n'a pas répondu à temps : retiré de la liste d'attente.`);
  await refreshMatchMessage(client, match);

  logEvent(client, "promote", {
    matchId: match.id,
    description: `Proposition expirée pour <@${offer.userId}> (Équipe ${teamNo}) — retiré de la liste d'attente.`,
  });

  await offerSpot(client, match, teamNo);
}

/** Le joueur accepte la place (bouton « Prendre la place »). */
async function acceptOffer(client, match, teamNo, candidateId) {
  const offer = match.offers?.[teamNo];
  if (!offer || offer.userId !== candidateId) {
    return { ok: false, error: "Cette proposition n'est plus valable." };
  }
  if (teamIsFull(match, teamNo)) {
    return { ok: false, error: `L'Équipe ${teamNo} est déjà complète.` };
  }

  clearTimer(offerTimers, offerKey(match.id, teamNo));
  delete match.offers[teamNo];
  store.save();

  await promoteCandidate(client, match, teamNo, candidateId, "après confirmation");
  await closeOfferMessage(client, match, offer, `✅ <@${candidateId}> a pris la place en **Équipe ${teamNo}**.`);
  return { ok: true };
}

/** Le joueur passe son tour : il repart en fin de liste, au suivant. */
async function declineOffer(client, match, teamNo, candidateId) {
  const offer = match.offers?.[teamNo];
  if (!offer || offer.userId !== candidateId) {
    return { ok: false, error: "Cette proposition n'est plus valable." };
  }

  clearTimer(offerTimers, offerKey(match.id, teamNo));
  delete match.offers[teamNo];

  // Passer son tour ≠ quitter : le joueur retourne en fin de liste d'attente.
  match.waitlist = [...match.waitlist.filter((id) => id !== candidateId), candidateId];
  store.save();

  await closeOfferMessage(client, match, offer, `⏭️ <@${candidateId}> a passé son tour.`);
  await refreshMatchMessage(client, match);

  // Si personne d'autre n'attend, on évite de reproposer en boucle au même joueur.
  if (match.waitlist[0] !== candidateId) {
    await offerSpot(client, match, teamNo);
  } else {
    await announce(client, match, {
      embeds: [infoEmbed(`${config.emojis.waitlist} Plus personne d'autre en attente : la place en **Équipe ${teamNo}** reste ouverte.`)],
    });
  }
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
    // Si la partie tourne déjà et que le joueur est en vocal, on le place direct.
    if (match.status === "live") await moveToTeamChannel(guild, match, teamNo, candidateId);
  }

  logEvent(client, "promote", {
    matchId: match.id,
    description: `<@${candidateId}> ajouté à l'Équipe ${teamNo} depuis la liste d'attente (${howLabel}).`,
  });
}

/** Désactive les boutons du message de proposition et affiche le verdict. */
async function closeOfferMessage(client, match, offer, verdict) {
  if (!offer?.messageId) return;
  const channel = await fetchMatchChannel(client, match);
  if (!channel) return;
  try {
    const message = await channel.messages.fetch(offer.messageId);
    await message.edit({ embeds: [infoEmbed(verdict)], components: [] });
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
  let warnings = 0;
  let offers = 0;

  for (const match of store.allMatches()) {
    if (match.status === "ended") continue;

    for (const [userId, warning] of Object.entries(match.warnings || {})) {
      scheduleWarning(client, match.id, userId, warning.deadline);
      warnings += 1;
    }
    for (const [teamNo, offer] of Object.entries(match.offers || {})) {
      scheduleOfferExpiry(client, match.id, Number(teamNo), offer.deadline);
      offers += 1;
    }
  }

  if (warnings || offers) {
    console.log(`[warnings] Reprise : ${warnings} avertissement(s) et ${offers} proposition(s) ré-armés.`);
  }
}

module.exports = {
  startWarning, cancelWarning, resolveWarning, clearMatchTimers,
  offerSpot, acceptOffer, declineOffer,
  restoreTimers,
};
