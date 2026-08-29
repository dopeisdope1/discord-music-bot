/**
 * ═══════════════════════════════════════════════════════════════════════
 *  AUTOMATISATIONS — la partie se déroule toute seule
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Une fois `+custom` lancé, plus rien n'est obligatoire :
 *
 *   1. Les joueurs cliquent sur « Rejoindre Équipe 1 / 2 ».
 *   2. Dès que les deux équipes sont complètes → **lancement automatique** :
 *      salons vocaux créés, joueurs déjà en vocal déplacés. (`autoStart`)
 *   3. Ceux qui ne sont pas en vocal au lancement sont **avertis
 *      automatiquement** : 60 s pour arriver, sinon retrait et place donnée à
 *      la liste d'attente. (`autoWarn`)
 *   4. Quand les salons d'équipe restent vides, la partie se **termine toute
 *      seule** et les salons sont supprimés. (`autoEndMinutes`)
 *
 * Chaque étape est débrayable depuis le panneau (⚙️ Réglages).
 */

const store = require("./store");
const settings = require("./settings");
const { logEvent } = require("./logger");
const { missingBotPermissions } = require("./permissions");
const { refreshMatchMessage, announce, teamIsFull } = require("./matches");
const { infoEmbed, successEmbed } = require("./embeds");
const {
  createTeamChannels, ensureTeamChannels, moveToTeamChannel, isInTeamVoice,
  getTeamChannelId, syncTeamPermissions,
} = require("./voice");
const warnings = require("./warnings");
const { withLock } = require("./mutex");

/** @type {Map<string, NodeJS.Timeout>} minuteries de fin automatique, par partie */
const emptyTimers = new Map();
/** @type {Map<string, NodeJS.Timeout>} lancements programmés à l'heure dite */
const startTimers = new Map();

// setTimeout plafonne à ~24,8 jours.
const MAX_TIMEOUT = 2 ** 31 - 1;

// ═══════════════════════ LANCEMENT DE LA PARTIE ═══════════════════════

/**
 * Lance la partie : salons vocaux, déplacements, avertissement des absents.
 * Utilisé par le bouton « Lancer la partie » ET par le lancement automatique.
 *
 * @returns {Promise<{ok: boolean, error?: string, moved?: number, warned?: string[]}>}
 */
async function launchMatch(client, guild, match, { actorId, parentId = null, auto = false } = {}) {
  if (!guild) return { ok: false, error: "Serveur introuvable." };

  // Tout ce qui modifie la partie passe par le verrou : deux inscriptions
  // simultanées sur la dernière place ne peuvent pas lancer deux fois.
  const prepared = await withLock(`match:${match.id}`, async () => {
    if (match.status !== "waiting") return { error: "Cette partie est déjà lancée ou terminée." };
    if (!match.teams[1].length || !match.teams[2].length) {
      return { error: "Il faut au moins un joueur dans chaque équipe pour lancer la partie." };
    }

    const missing = missingBotPermissions(guild);
    if (missing.length) {
      return { error: `Il me manque des permissions pour créer les salons vocaux : **${missing.join(", ")}**.` };
    }

    // ---- Équilibrage par rang, juste avant de figer les équipes ----
    // C'est le dernier moment où l'on connaît la composition définitive : les
    // permissions des salons sont calculées ensuite, sur les bonnes équipes.
    let balanced = null;
    if (settings.get("autoBalance")) {
      const { applyBalance } = require("./matchActions");
      const result = applyBalance(client, match);
      if (!result.error) balanced = result;
    }

    const { error } = await createTeamChannels(guild, match, parentId);
    if (error) return { error: `Création des salons vocaux impossible : ${error}` };

    match.status = "live";
    match.startedAt = Date.now();
    match.startAt = null;
    cancelScheduledStart(match.id);
    store.save();
    return { balanced };
  });

  if (prepared.error) return { ok: false, error: prepared.error };

  await refreshMatchMessage(client, match);

  // Déplacement automatique de ceux qui sont déjà connectés quelque part.
  let moved = 0;
  for (const teamNo of [1, 2]) {
    for (const userId of match.teams[teamNo]) {
      const result = await moveToTeamChannel(guild, match, teamNo, userId);
      if (result.moved) moved += 1;
    }
  }

  const balanceLine = prepared.balanced?.moved
    ? `⚖️ Équipes équilibrées par rang — écart de force : **${prepared.balanced.gap}**.`
    : null;

  await announce(client, match, {
    embeds: [infoEmbed([
      `▶️ **La partie est lancée${auto ? " automatiquement (équipes complètes)" : ""} !**`,
      "",
      `🔴 Équipe 1 · <#${match.voice[1]}>`,
      `🔵 Équipe 2 · <#${match.voice[2]}>`,
      "",
      moved ? `${moved} joueur(s) déjà en vocal ont été déplacés.` : "Rejoignez le salon de votre équipe.",
      balanceLine,
    ].filter((line) => line !== null).join("\n"))],
  });

  logEvent(client, "start", {
    matchId: match.id,
    description: `Partie lancée ${auto ? "automatiquement" : `par <@${actorId}>`} — salons créés, ${moved} joueur(s) déplacé(s).`,
  });

  // Surveillance de présence : un seul moniteur pour toutes les parties.
  require("./monitor").watch(client);

  const warned = settings.get("autoWarn") ? await warnAbsentees(client, guild, match, actorId) : [];
  return { ok: true, moved, warned, balanced: prepared.balanced };
}

/**
 * Avertit d'un coup tous les joueurs absents du vocal de leur équipe.
 * Un seul message public groupé, mais un timer indépendant par joueur : chacun
 * garde ses 60 s et son propre retrait.
 *
 * @returns {Promise<string[]>} les IDs avertis
 */
async function warnAbsentees(client, guild, match, actorId) {
  const absentees = [];

  for (const teamNo of [1, 2]) {
    for (const userId of match.teams[teamNo]) {
      if (match.warnings?.[userId]) continue; // déjà sous avertissement
      const present = await isInTeamVoice(guild, match, teamNo, userId);
      if (!present) absentees.push(userId);
    }
  }
  if (!absentees.length) return [];

  for (const userId of absentees) {
    // `notify: false` : pas de message individuel, on en poste un seul groupé.
    await warnings.startWarning(client, match, userId, actorId || client.user.id, { notify: false });
  }

  const seconds = settings.warnSeconds();
  await announce(client, match, {
    content: absentees.map((id) => `<@${id}>`).join(" "),
    embeds: [infoEmbed([
      `⚠️ **Vous n'êtes pas dans le salon vocal de votre équipe.**`,
      "",
      `Vous avez **${seconds} secondes** pour le rejoindre.`,
      "Passé ce délai, votre place sera donnée à quelqu'un d'autre.",
      "",
      `⏳ Fin du délai <t:${Math.floor((Date.now() + settings.get("warnMs")) / 1000)}:R>`,
    ].join("\n"))],
    mentionUsers: absentees,
  });

  logEvent(client, "warn", {
    matchId: match.id,
    description: `Avertissement automatique au lancement : ${absentees.length} joueur(s) absent(s) du vocal.`,
  });

  return absentees;
}

/**
 * Lance la partie toute seule dès que les deux équipes sont complètes.
 * Appelé après chaque inscription.
 */
async function maybeAutoStart(client, guild, match, parentId = null) {
  if (!settings.get("autoStart")) return false;
  if (match.status !== "waiting" || !guild) return false;
  if (!teamIsFull(match, 1) || !teamIsFull(match, 2)) return false;

  const result = await launchMatch(client, guild, match, { parentId, auto: true });
  if (!result.ok) {
    // On prévient plutôt que d'échouer en silence : l'hôte peut lancer à la main.
    await announce(client, match, {
      embeds: [infoEmbed(`⚠️ Lancement automatique impossible : ${result.error}\nUtilisez le bouton **Lancer la partie**.`)],
    });
    return false;
  }
  return true;
}

// ═══════════════════════ LANCEMENT PROGRAMMÉ ═══════════════════════

/**
 * Programme le lancement d'une partie à l'heure choisie (`+custom 21h30`).
 * L'échéance est persistée sur la partie : un redémarrage la ré-arme.
 */
function scheduleStart(client, matchId, startAt) {
  cancelScheduledStart(matchId);

  const delay = Math.min(Math.max(startAt - Date.now(), 0), MAX_TIMEOUT);
  const timer = setTimeout(() => {
    startTimers.delete(matchId);
    runScheduledStart(client, matchId).catch((error) =>
      console.error(`[automation] Lancement programmé impossible (#${matchId}) :`, error.message));
  }, delay);

  timer.unref?.();
  startTimers.set(matchId, timer);
}

function cancelScheduledStart(matchId) {
  const timer = startTimers.get(matchId);
  if (timer) clearTimeout(timer);
  startTimers.delete(matchId);
}

async function runScheduledStart(client, matchId) {
  const match = store.getMatch(matchId);
  if (!match || match.status !== "waiting") return;

  match.startAt = null; // l'heure est consommée, quoi qu'il arrive
  store.save();

  const guild = await client.guilds.fetch(match.guildId).catch(() => null);
  if (!guild) return;

  const result = await launchMatch(client, guild, match, { auto: true });
  if (!result.ok) {
    await announce(client, match, {
      embeds: [infoEmbed(`⏰ L'heure de début est arrivée, mais le lancement a échoué : ${result.error}`)],
    });
    await refreshMatchMessage(client, match);
  }
}

/** Ré-arme les lancements programmés après un redémarrage. */
function restoreScheduledStarts(client) {
  let restored = 0;
  for (const match of store.allMatches()) {
    if (match.status !== "waiting" || !match.startAt) continue;
    scheduleStart(client, match.id, match.startAt);
    restored += 1;
  }
  if (restored) console.log(`[automation] Reprise : ${restored} lancement(s) programmé(s) ré-armé(s).`);
}

// ═══════════════════════ FIN AUTOMATIQUE ═══════════════════════

const emptyKey = (matchId) => `empty:${matchId}`;

function cancelEmptyTimer(matchId) {
  const timer = emptyTimers.get(emptyKey(matchId));
  if (timer) clearTimeout(timer);
  emptyTimers.delete(emptyKey(matchId));
}

/** Les deux salons d'équipe sont-ils vides (ou inexistants) ? */
async function teamChannelsAreEmpty(guild, match) {
  for (const teamNo of [1, 2]) {
    const channelId = getTeamChannelId(match, teamNo);
    if (!channelId) continue;
    try {
      const channel = await guild.channels.fetch(channelId);
      // On ne compte pas les bots : un bot musique resté connecté ne doit pas
      // maintenir une partie ouverte indéfiniment.
      if (channel?.members?.some((member) => !member.user.bot)) return false;
    } catch {
      // Salon supprimé à la main : il compte comme vide.
    }
  }
  return true;
}

/**
 * Appelé quand quelqu'un quitte un salon d'équipe : si les deux salons sont
 * vides, on programme la fin automatique de la partie.
 */
async function checkEmptyChannels(client, guild, match) {
  const minutes = settings.get("autoEndMinutes");
  if (!minutes || match.status !== "live") return;

  if (!(await teamChannelsAreEmpty(guild, match))) {
    cancelEmptyTimer(match.id);
    return;
  }
  if (emptyTimers.has(emptyKey(match.id))) return; // déjà programmée

  const timer = setTimeout(async () => {
    emptyTimers.delete(emptyKey(match.id));
    try {
      const current = store.getMatch(match.id);
      if (!current || current.status !== "live") return;
      if (!(await teamChannelsAreEmpty(guild, current))) return; // quelqu'un est revenu

      // require paresseux : matchActions dépend de ce module (maybeAutoStart).
      const { endMatch } = require("./matchActions");
      await endMatch(client, current, client.user.id);
      await announce(client, current, {
        embeds: [successEmbed(`🛑 Partie terminée automatiquement : les salons vocaux sont restés vides ${minutes} minutes.`)],
      });
      logEvent(client, "end", {
        matchId: current.id,
        description: `Fin automatique après ${minutes} min de salons vocaux vides.`,
      });
    } catch (error) {
      console.error(`[automation] Fin automatique impossible (#${match.id}) :`, error.message);
    }
  }, minutes * 60 * 1000);

  timer.unref?.();
  emptyTimers.set(emptyKey(match.id), timer);
}

/** Quelqu'un est revenu : on annule la fin programmée. */
function cancelAutoEnd(matchId) {
  cancelEmptyTimer(matchId);
}

// ═══════════════════ REPRISE DES PARTIES APRÈS REDÉMARRAGE ═══════════════════

/**
 * Le bot a redémarré au milieu d'une partie : on la reprend là où elle en
 * était, sans rien demander à personne.
 *
 *   1. Les salons d'équipe existent-ils encore ? Sinon on les recrée.
 *   2. Les permissions sont resynchronisées (l'effectif a pu changer).
 *   3. La présence est revérifiée : quelqu'un a pu partir pendant la coupure.
 *   4. Le panneau est redessiné avec l'état réel.
 *
 * Les avertissements en cours, eux, sont ré-armés par warnings.restoreTimers().
 */
async function resumeLiveMatches(client) {
  const live = store.allMatches().filter((match) => match.status === "live");
  if (!live.length) return 0;

  let resumed = 0;

  for (const match of live) {
    try {
      const guild = await client.guilds.fetch(match.guildId).catch(() => null);
      if (!guild) continue;

      // Salons supprimés pendant la coupure : on les recrée à l'identique.
      const { recreated, error } = await ensureTeamChannels(guild, match, null);
      if (error) {
        logEvent(client, "error", {
          matchId: match.id,
          description: `Reprise partielle : recréation des salons impossible — ${error}`,
        });
      } else if (recreated.length) {
        store.save();
        logEvent(client, "voice", {
          matchId: match.id,
          description: `Reprise : salon(s) d'équipe ${recreated.join(" et ")} recréé(s) après redémarrage.`,
        });
      }

      for (const teamNo of [1, 2]) await syncTeamPermissions(guild, match, teamNo);
      await refreshMatchMessage(client, match);

      // Quelqu'un est parti pendant la coupure : on relance le cycle normal.
      if (settings.get("autoWarn")) await warnAbsentees(client, guild, match, client.user.id);

      resumed += 1;
    } catch (error) {
      console.error(`[automation] Reprise impossible (#${match.id}) :`, error.message);
    }
  }

  if (resumed) console.log(`[automation] Reprise : ${resumed} partie(s) en cours ré-synchronisée(s).`);
  return resumed;
}

module.exports = {
  launchMatch, warnAbsentees, maybeAutoStart,
  scheduleStart, cancelScheduledStart, restoreScheduledStarts,
  checkEmptyChannels, cancelAutoEnd, resumeLiveMatches,
};
