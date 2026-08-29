/**
 * ═══════════════════════════════════════════════════════════════════════
 *  ACTIONS SUR UNE PARTIE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Point d'entrée unique de tout ce qu'un joueur peut déclencher : bouton, menu
 * déroulant, modale ou commande préfixe. Le panneau de la partie reste la seule
 * source de vérité publique — chaque action répond en **éphémère**.
 *
 * Trois règles tenues partout dans ce fichier :
 *
 *   1. **Rien n'est déduit du `customId`.** Appartenance, droits, état de la
 *      partie : tout est revérifié côté serveur à chaque clic.
 *   2. **Toute mutation passe par un verrou** (`utils/mutex.js`). Deux clics
 *      simultanés sur la dernière place ne peuvent pas réussir tous les deux.
 *   3. **Une interaction est toujours acquittée** — `deferReply` avant tout
 *      appel réseau (API de rangs, création de salons), sinon Discord ferme la
 *      fenêtre de 3 secondes et le joueur voit « l'application ne répond pas ».
 */

const { MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const config = require("../config");
const store = require("./store");
const settings = require("./settings");
const { withLock } = require("./mutex");
const { logEvent } = require("./logger");
const { canManage } = require("./permissions");
const { meetsMinimum, rankEmoji, RANK_BY_KEY, parseRank, RANK_HELP } = require("./ranks");
const rankService = require("./rankService");
const riot = require("./riot");
const { balanceTeams, suggestTeam } = require("./balance");
const {
  findTeam, isInWaitlist, isInMatch, teamIsFull, playerCount, matchIsFull,
  removePlayer, addToTeam, addToWaitlist,
  refreshMatchMessage, announce,
} = require("./matches");
const {
  errorEmbed, successEmbed, infoEmbed,
  buildWarnSelect, buildProfileModal, parseCustomId, customId,
} = require("./embeds");
const {
  createTeamChannels, deleteTeamChannels, syncTeamPermissions, moveToTeamChannel,
  presenceSnapshot, getTeamChannelId,
} = require("./voice");
const warnings = require("./warnings");
const { panelView } = require("./display");

/** Clé de verrou : toutes les mutations d'une même partie sont sérialisées. */
const lockKey = (match) => `match:${match.id}`;

// ─────────────────────────── réponses privées ───────────────────────────

/**
 * Répond en éphémère quel que soit l'état de l'interaction (fraîche, différée,
 * ou déjà répondue après une modale). Ne lève jamais : une interaction expirée
 * ne doit pas faire remonter d'exception dans la logique métier.
 */
async function respond(interaction, embed, components = []) {
  const payload = { embeds: [embed], components };
  try {
    if (interaction.deferred && !interaction.replied) return await interaction.editReply(payload);
    if (interaction.replied) return await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } catch (error) {
    console.error("[actions] Réponse impossible :", error.message);
    return null;
  }
}

const replyError = (interaction, message) => respond(interaction, errorEmbed(message));
const replyOk = (interaction, message) => respond(interaction, successEmbed(message));
const replyInfo = (interaction, message) => respond(interaction, infoEmbed(message));

/** Acquitte l'interaction avant tout appel réseau potentiellement lent. */
async function defer(interaction) {
  if (interaction.deferred || interaction.replied) return;
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch {
    // Interaction déjà expirée : les réponses suivantes échoueront proprement.
  }
}

const prefix = () => settings.get("prefix");

// ────────────────────────── profil & rang ──────────────────────────

/**
 * S'assure que le joueur a un compte Riot lié.
 *
 * @returns {Promise<object|null>} le profil, ou null si une modale a été
 *          ouverte (l'action sera rejouée après validation) ou si l'action doit
 *          s'arrêter là.
 */
async function requireProfile(interaction, match, pendingAction) {
  const profile = store.getProfile(interaction.user.id);
  if (profile?.riotId) return profile;

  // Depuis un composant : on ouvre la modale, l'action reprendra ensuite.
  if (typeof interaction.showModal === "function" && !interaction.deferred && !interaction.replied) {
    await interaction.showModal(buildProfileModal(match.id, pendingAction));
    return null;
  }

  await replyError(
    interaction,
    `Lie d'abord ton compte : \`${prefix()}lier TonPseudo#TAG\`.`,
  );
  return null;
}

/**
 * Rafraîchit le rang au moment de l'inscription — c'est là tout l'intérêt :
 * le joueur ne tape jamais son rang, et celui affiché est celui du jour.
 * Silencieux par nature : une API en panne ne doit jamais empêcher de jouer.
 */
async function syncRankQuietly(userId) {
  if (!riot.isEnabled()) return false;
  return rankService.ensureFreshRank(userId);
}

/**
 * Le joueur satisfait-il le rang minimum de la partie ?
 * @returns {string|null} le message de refus, ou null si c'est bon.
 */
function rankGate(match, profile) {
  if (!match.minRank) return null;

  const required = RANK_BY_KEY.get(match.minRank);
  if (!required) return null;

  if (profile.source === "unknown" || !profile.rank) {
    return `Cette partie demande **${rankEmoji(required.key)} ${required.label}** minimum, mais ton rang n'a pas pu être récupéré.\n` +
      `Renseigne-le à la main : \`${prefix()}rang ${required.label}\`.`;
  }
  if (!meetsMinimum(profile.rank, match.minRank)) {
    return `Rang insuffisant : cette partie demande **${rankEmoji(required.key)} ${required.label}** minimum, ` +
      `ton profil indique ${rankService.formatProfileRank(profile)}.`;
  }
  return null;
}

// ═════════════════════════════ REJOINDRE ═════════════════════════════

/**
 * Inscription dans une équipe précise (bouton accessoire d'un bloc d'équipe).
 * `teamNo === null` = laisser le bot choisir (bouton « Rejoindre la partie »).
 */
async function actionJoin(interaction, match, teamNo = null) {
  const userId = interaction.user.id;
  if (match.status === "ended") return replyError(interaction, "Cette partie est terminée.");

  const pending = teamNo ? `join:${teamNo}` : "join-auto";
  const profile = await requireProfile(interaction, match, pending);
  if (!profile) return null;

  await defer(interaction);
  await syncRankQuietly(userId);

  const fresh = store.getProfile(userId);
  const refusal = rankGate(match, fresh);
  if (refusal) return replyError(interaction, refusal);

  const result = await withLock(lockKey(match), async () => {
    if (match.status === "ended") return { error: "Cette partie est terminée." };

    const currentTeam = findTeam(match, userId);

    // Équipe choisie par le bot : la moins remplie, à effectif égal la moins
    // forte — l'équilibrage fin a lieu au lancement.
    const target = teamNo || suggestTeam({
      team1: match.teams[1],
      team2: match.teams[2],
      perTeam: match.format.perTeam,
      strengthOf: rankService.strengthOf,
      newcomer: userId,
    });

    if (!target) {
      return {
        error: `La partie est complète (${playerCount(match)}/${match.format.perTeam * 2}). ` +
          "Prends la **liste d'attente** : tu récupéreras la première place libérée.",
      };
    }
    if (currentTeam === target) return { error: `Tu es déjà dans l'**Équipe ${target}**.` };
    if (teamIsFull(match, target)) {
      return {
        error: `L'**Équipe ${target}** est complète (${match.format.perTeam}/${match.format.perTeam}). ` +
          "Utilise **Rejoindre la partie** pour être placé automatiquement, ou la **liste d'attente**.",
      };
    }

    // Changer d'équipe alors qu'on est averti annule l'avertissement en cours.
    await warnings.cancelWarning(interaction.client, match, userId, { silent: true });
    addToTeam(match, userId, target);
    store.save();

    return { teamNo: target, previousTeam: currentTeam };
  });

  if (result.error) return replyError(interaction, result.error);

  await refreshMatchMessage(interaction.client, match);

  if (interaction.guild) {
    if (result.previousTeam) await syncTeamPermissions(interaction.guild, match, result.previousTeam);
    await syncTeamPermissions(interaction.guild, match, result.teamNo);
    // Partie déjà lancée : le joueur est placé tout de suite.
    if (match.status === "live") await moveToTeamChannel(interaction.guild, match, result.teamNo, userId);
  }

  logEvent(interaction.client, "join", {
    matchId: match.id,
    description: `<@${userId}> rejoint l'Équipe ${result.teamNo} (${fresh.riotId} · ${rankService.formatProfileRank(fresh)}).`,
  });

  const suffix = result.previousTeam ? ` (tu as quitté l'Équipe ${result.previousTeam})` : "";
  await replyOk(interaction, `Tu rejoins l'**Équipe ${result.teamNo}**${suffix} — ${rankService.formatProfileRank(fresh)}.`);

  // Équipes au complet → la partie se lance toute seule (réglage autoStart).
  // Volontairement **hors du verrou** : le lancement prend le sien.
  const automation = require("./automation");
  await automation.maybeAutoStart(interaction.client, interaction.guild, match, interaction.channel?.parentId || null);
  return true;
}

// ═════════════════════════ LISTE D'ATTENTE ═════════════════════════

async function actionWaitlist(interaction, match) {
  const userId = interaction.user.id;
  if (match.status === "ended") return replyError(interaction, "Cette partie est terminée.");

  const profile = await requireProfile(interaction, match, "waitlist");
  if (!profile) return null;

  await defer(interaction);
  await syncRankQuietly(userId);

  const refusal = rankGate(match, store.getProfile(userId));
  if (refusal) return replyError(interaction, refusal);

  const result = await withLock(lockKey(match), async () => {
    if (isInWaitlist(match, userId)) {
      return { error: `Tu es déjà en liste d'attente (**position ${match.waitlist.indexOf(userId) + 1}**). Utilise **Quitter** pour en sortir.` };
    }

    const previousTeam = findTeam(match, userId);
    await warnings.cancelWarning(interaction.client, match, userId, { silent: true });
    addToWaitlist(match, userId);
    store.save();
    return { previousTeam, position: match.waitlist.indexOf(userId) + 1 };
  });

  if (result.error) return replyError(interaction, result.error);

  await refreshMatchMessage(interaction.client, match);
  if (result.previousTeam && interaction.guild) {
    await syncTeamPermissions(interaction.guild, match, result.previousTeam);
  }

  logEvent(interaction.client, "join", {
    matchId: match.id,
    description: `<@${userId}> entre en liste d'attente (position ${result.position}).`,
  });

  // Une place s'est libérée en quittant son équipe : on la propose tout de suite.
  if (result.previousTeam) await warnings.offerSpot(interaction.client, match, result.previousTeam);

  return replyOk(interaction, `Tu es en **liste d'attente** — position **${result.position}**.`);
}

// ═══════════════════════════════ QUITTER ═══════════════════════════════

async function actionLeave(interaction, match) {
  const userId = interaction.user.id;
  if (!isInMatch(match, userId)) return replyError(interaction, "Tu ne participes pas à cette partie.");

  await defer(interaction);

  const teamNo = await withLock(lockKey(match), async () => {
    await warnings.cancelWarning(interaction.client, match, userId, { silent: true });
    const team = removePlayer(match, userId);
    store.save();
    return team;
  });

  await refreshMatchMessage(interaction.client, match);
  if (teamNo && interaction.guild) await syncTeamPermissions(interaction.guild, match, teamNo);

  logEvent(interaction.client, "leave", {
    matchId: match.id,
    description: `<@${userId}> a quitté ${teamNo ? `l'Équipe ${teamNo}` : "la liste d'attente"}.`,
  });

  if (teamNo) {
    await announce(interaction.client, match, {
      embeds: [infoEmbed(`↩️ <@${userId}> quitte l'**Équipe ${teamNo}** — une place est libre.`)],
    });
    await warnings.offerSpot(interaction.client, match, teamNo);
  }

  return replyOk(interaction, teamNo ? `Tu as quitté l'**Équipe ${teamNo}**.` : "Tu as quitté la liste d'attente.");
}

// ═══════════════════════ LANCER / TERMINER LA PARTIE ═══════════════════════

async function actionStart(interaction, match) {
  if (!canManage(match, interaction.member)) {
    return replyError(interaction, "Seul l'hôte de la partie (ou un responsable) peut la lancer.");
  }

  await defer(interaction);

  const automation = require("./automation");
  const result = await automation.launchMatch(interaction.client, interaction.guild, match, {
    actorId: interaction.user.id,
    parentId: interaction.channel?.parentId || null,
  });

  if (!result.ok) return replyError(interaction, result.error);

  const parts = [`Partie lancée. Salons créés, **${result.moved}** joueur(s) déplacé(s).`];
  if (result.balanced?.moved) parts.push(`⚖️ Équipes équilibrées (**${result.balanced.moved}** changement(s), écart ${result.balanced.gap}).`);
  if (result.warned?.length) parts.push(`⚠️ **${result.warned.length}** absent(s) averti(s) automatiquement.`);

  return replyOk(interaction, parts.join("\n"));
}

/**
 * Fin de partie, sans interaction : timers coupés, salons supprimés, panneau
 * figé. Utilisé par le bouton « Terminer », le panneau de contrôle et la fin
 * automatique.
 *
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function endMatch(client, match, actorId) {
  return withLock(lockKey(match), async () => {
    if (match.status === "ended") return { ok: false, error: "Cette partie est déjà terminée." };

    warnings.clearMatchTimers(match);
    match.warnings = {};
    match.offers = {};
    match.status = "ended";
    store.save();

    await deleteTeamChannels(client, match);
    store.save();
    await refreshMatchMessage(client, match);

    await announce(client, match, {
      embeds: [infoEmbed(`${config.emojis.end} **Partie terminée** par <@${actorId}>. Merci à tous !`)],
    });

    logEvent(client, "end", {
      matchId: match.id,
      description: `Partie terminée par <@${actorId}> (${playerCount(match)} joueur(s) inscrits).`,
    });

    return { ok: true };
  });
}

async function actionEnd(interaction, match) {
  if (!canManage(match, interaction.member)) {
    return replyError(interaction, "Seul l'hôte de la partie (ou un membre du staff) peut la terminer.");
  }
  if (match.status === "ended") return replyError(interaction, "Cette partie est déjà terminée.");

  await defer(interaction);

  const result = await endMatch(interaction.client, match, interaction.user.id);
  if (!result.ok) return replyError(interaction, result.error);

  return replyOk(interaction, "Partie terminée et salons vocaux supprimés.");
}

// ═════════════════════════════ ÉQUILIBRAGE ═════════════════════════════

/**
 * Rééquilibre les deux équipes par rang, à la demande.
 * Réservé aux responsables : c'est un changement visible pour tout le monde.
 */
async function actionBalance(interaction, match) {
  if (!canManage(match, interaction.member)) {
    return replyError(interaction, "Seul l'hôte de la partie (ou un responsable) peut rééquilibrer les équipes.");
  }
  if (match.status === "ended") return replyError(interaction, "Cette partie est terminée.");

  await defer(interaction);

  const result = await withLock(lockKey(match), () => applyBalance(interaction.client, match));
  if (result.error) return replyError(interaction, result.error);

  await refreshMatchMessage(interaction.client, match);

  if (interaction.guild) {
    for (const teamNo of [1, 2]) await syncTeamPermissions(interaction.guild, match, teamNo);
    if (match.status === "live") {
      for (const teamNo of [1, 2]) {
        for (const userId of match.teams[teamNo]) await moveToTeamChannel(interaction.guild, match, teamNo, userId);
      }
    }
  }

  logEvent(interaction.client, "balance", {
    matchId: match.id,
    description: `Équipes rééquilibrées par <@${interaction.user.id}> — ${result.moved} changement(s), écart ${result.gap}.`,
  });

  if (!result.moved) return replyOk(interaction, "Les équipes sont déjà aussi équilibrées que possible.");

  await announce(interaction.client, match, {
    embeds: [successEmbed(`${config.emojis.balance} **Équipes rééquilibrées** — ${result.moved} joueur(s) déplacé(s).`)],
  });
  return replyOk(interaction, `${config.emojis.balance} Équipes rééquilibrées : **${result.moved}** changement(s), écart de force **${result.gap}**.`);
}

/**
 * Applique l'équilibrage à une partie. **Suppose le verrou déjà pris.**
 * Partagé par le bouton « Équilibrer », le lancement et le panneau de contrôle.
 *
 * @returns {{moved: number, gap: number, error?: string}}
 */
function applyBalance(client, match) {
  const players = [...match.teams[1], ...match.teams[2]];
  if (players.length < 2) return { error: "Il faut au moins deux joueurs pour équilibrer.", moved: 0, gap: 0 };

  const result = balanceTeams({
    team1: match.teams[1],
    team2: match.teams[2],
    perTeam: match.format.perTeam,
    strengthOf: rankService.strengthOf,
  });

  match.teams[1] = result.team1;
  match.teams[2] = result.team2;
  // Un équilibrage ne fait jamais disparaître personne : le surplus repasse en
  // tête de liste d'attente.
  if (result.overflow.length) match.waitlist = [...result.overflow, ...match.waitlist];
  store.save();

  // L'écart est exprimé en « centièmes de division » : /100 le rend lisible.
  return { moved: result.moved, gap: Math.round(result.diff / 10) / 10, overflow: result.overflow.length };
}

// ═════════════════════════════ AVERTIR ═════════════════════════════

async function actionWarnMenu(interaction, match) {
  if (!canManage(match, interaction.member)) {
    return replyError(interaction, "Seul l'hôte de la partie (ou un membre du staff) peut avertir un joueur.");
  }
  const row = buildWarnSelect(match);
  if (!row) return replyError(interaction, "Aucun joueur n'est inscrit dans les équipes pour l'instant.");

  return respond(
    interaction,
    infoEmbed(`${config.emojis.warn} Sélectionne le joueur à avertir. Il aura **${settings.warnSeconds()} secondes** pour rejoindre le vocal de son équipe.`),
    [row],
  );
}

/** Point d'entrée commun au menu déroulant et à la commande `avertir`. */
async function runWarning(interaction, match, targetId) {
  if (!canManage(match, interaction.member)) {
    return replyError(interaction, "Seul l'hôte de la partie (ou un membre du staff) peut avertir un joueur.");
  }

  await defer(interaction);
  const result = await warnings.startWarning(interaction.client, match, targetId, interaction.user.id);
  if (!result.ok) return replyError(interaction, result.error);

  return replyOk(
    interaction,
    `<@${targetId}> a été averti (**Équipe ${result.teamNo}**). Retrait automatique dans **${settings.warnSeconds()} s** s'il ne rejoint pas le vocal.`,
  );
}

// ═══════════════════ « PRENDRE SA PLACE » ═══════════════════

/**
 * N'importe qui peut cliquer : mêmes vérifications qu'une inscription normale,
 * plus la fenêtre de priorité de la liste d'attente. L'attribution elle-même
 * est atomique (verrou dans warnings.claimSpot).
 */
async function actionClaim(interaction, match, teamNo) {
  const userId = interaction.user.id;

  if (!settings.get("allowReplacement")) {
    return replyError(interaction, "Le remplacement des joueurs absents est désactivé sur ce bot.");
  }

  const profile = await requireProfile(interaction, match, `claim:${teamNo}`);
  if (!profile) return null;

  await defer(interaction);
  await syncRankQuietly(userId);

  const refusal = rankGate(match, store.getProfile(userId));
  if (refusal) return replyError(interaction, refusal);

  const result = await warnings.claimSpot(interaction.client, match, teamNo, userId);
  if (!result.ok) return replyError(interaction, result.error);

  return replyOk(interaction, `Tu prends la place libre en **Équipe ${teamNo}** !`);
}

// ═══════════════════════ CONFORT : VOCAL, ÉQUIPES, RANG ═══════════════════════

/** « 🎙️ Mon vocal » — déplace le joueur, ou lui donne le lien du salon. */
async function actionMyVoice(interaction, match) {
  const userId = interaction.user.id;
  const teamNo = findTeam(match, userId);

  if (!teamNo) return replyError(interaction, "Tu n'es dans aucune des deux équipes de cette partie.");

  const channelId = getTeamChannelId(match, teamNo);
  if (!channelId) return replyError(interaction, "Les salons vocaux n'existent pas encore : la partie n'est pas lancée.");

  await defer(interaction);

  const result = await moveToTeamChannel(interaction.guild, match, teamNo, userId, { force: true });
  if (result.moved) return replyOk(interaction, `Tu as été déplacé dans <#${channelId}>.`);

  return replyInfo(
    interaction,
    `${config.emojis.voice} Ton salon : <#${channelId}> (**Équipe ${teamNo}**).\n-# ${result.reason}`,
  );
}

/** « 👥 Voir les équipes » — récapitulatif privé, avec présence et rangs. */
async function actionTeams(interaction, match) {
  const presence = interaction.guild ? presenceSnapshot(interaction.guild, match) : new Map();

  const block = (teamNo) => {
    const emoji = teamNo === 1 ? config.emojis.team1 : config.emojis.team2;
    const lines = match.teams[teamNo].map((userId, index) => {
      const profile = store.getProfile(userId);
      const state = match.status === "live"
        ? (presence.get(userId) ? config.emojis.present : config.emojis.absent)
        : "";
      return `\`${index + 1}.\` <@${userId}> — \`${profile?.riotId || "?"}\` · ${rankService.formatProfileRank(profile)} ${state}`;
    });
    if (!lines.length) lines.push("*vide*");
    return `${emoji} **ÉQUIPE ${teamNo}** — ${match.teams[teamNo].length}/${match.format.perTeam}\n${lines.join("\n")}`;
  };

  const view = panelView({
    title: `Équipes — partie #${match.id}`,
    body: [
      block(1),
      "",
      block(2),
      match.waitlist.length ? `\n${config.emojis.waitlist} **Liste d'attente** — ${match.waitlist.map((id) => `<@${id}>`).join(", ")}` : null,
    ],
    accent: match.status === "live" ? config.colors.live : config.colors.waiting,
    footer: "-# 🟢 présent dans le vocal de son équipe · 🔴 absent",
    ephemeral: true,
  });

  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply({ ...view, flags: undefined });
    else await interaction.reply(view);
  } catch (error) {
    console.error("[actions] Affichage des équipes impossible :", error.message);
  }
  return true;
}

/** « 🔄 Actualiser » — redessine le panneau public et confirme en privé. */
async function actionRefresh(interaction, match) {
  await defer(interaction);
  const userId = interaction.user.id;

  // Le rafraîchissement est aussi l'occasion de remettre son rang à jour.
  if (isInMatch(match, userId)) await syncRankQuietly(userId);

  await refreshMatchMessage(interaction.client, match);
  return replyOk(interaction, "Panneau actualisé.");
}

/** « 🔗 Mon compte Riot » — ouvre la modale de liaison. */
async function actionLink(interaction, match) {
  try {
    await interaction.showModal(buildProfileModal(match.id, "link"));
  } catch (error) {
    console.error("[actions] Modale de liaison impossible :", error.message);
  }
  return true;
}

// ═══════════════════════════ ROUTAGE ═══════════════════════════

async function handleComponent(interaction) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false; // pas une interaction du bot customs

  const match = store.getMatch(parsed.matchId);
  if (!match) {
    await replyError(
      interaction,
      `Cette partie n'existe plus (terminée ou purgée). Crée-en une nouvelle avec \`${prefix()}custom\`.`,
    );
    return true;
  }

  switch (parsed.action) {
    case "join":
      await actionJoin(interaction, match, Number(parsed.extra[0]));
      return true;
    case "join-auto":
      await actionJoin(interaction, match, null);
      return true;
    case "waitlist":
      await actionWaitlist(interaction, match);
      return true;
    case "leave":
      await actionLeave(interaction, match);
      return true;
    case "start":
      await actionStart(interaction, match);
      return true;
    case "end":
      await actionEnd(interaction, match);
      return true;
    case "balance":
      await actionBalance(interaction, match);
      return true;
    case "warn":
      await actionWarnMenu(interaction, match);
      return true;
    case "warn-select":
      await runWarning(interaction, match, interaction.values[0]);
      return true;
    case "claim":
      await actionClaim(interaction, match, Number(parsed.extra[0]));
      return true;
    case "myvoice":
      await actionMyVoice(interaction, match);
      return true;
    case "teams":
      await actionTeams(interaction, match);
      return true;
    case "refresh":
      await actionRefresh(interaction, match);
      return true;
    case "link":
      await actionLink(interaction, match);
      return true;
    default:
      return false;
  }
}

/**
 * Modale « Riot ID » : lie le compte, récupère le rang, puis **rejoue l'action
 * mise en attente** — le joueur a cliqué une fois, il ne reclique pas.
 */
async function handleProfileModal(interaction) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed || parsed.action !== "profile-modal") return false;

  // La liaison appelle l'API : on acquitte AVANT, sinon les 3 s sont dépassées.
  await defer(interaction);

  const riotId = interaction.fields.getTextInputValue("riotId").trim();
  // Champ présent uniquement quand la récupération automatique est indisponible.
  let manualRank = null;
  try {
    manualRank = interaction.fields.getTextInputValue("rank")?.trim() || null;
  } catch {
    manualRank = null;
  }

  if (manualRank && !parseRank(manualRank)) {
    return replyError(interaction, `Rang non reconnu : \`${manualRank}\`.\nValeurs acceptées : ${RANK_HELP} — avec une division (« Diamant 2 »).`);
  }

  const result = await rankService.linkAccount(interaction.user.id, riotId, { manualRank });
  if (!result.ok) return replyError(interaction, result.message);

  logEvent(interaction.client, "rank", {
    matchId: parsed.matchId,
    description: `<@${interaction.user.id}> a lié \`${result.profile.riotId}\` — ${rankService.formatProfileRank(result.profile)} (${rankService.sourceLabel(result.profile)}).`,
  });

  const match = store.getMatch(parsed.matchId);
  const summary = `Compte lié : \`${result.profile.riotId}\` · ${rankService.formatProfileRank(result.profile)}.` +
    (result.warning ? `\n⚠️ ${result.warning}` : "");

  if (!match) return replyOk(interaction, `${summary}\n-# Cette partie n'existe plus.`);

  // `extra` contient l'action mise en attente : "join:1", "join-auto", "claim:2"…
  const [pendingAction, teamNo] = parsed.extra;

  if (pendingAction === "join") return actionJoin(interaction, match, Number(teamNo));
  if (pendingAction === "join-auto") return actionJoin(interaction, match, null);
  if (pendingAction === "claim") return actionClaim(interaction, match, Number(teamNo));
  if (pendingAction === "waitlist") return actionWaitlist(interaction, match);

  // Simple liaison depuis le bouton « Mon compte Riot ».
  for (const other of require("./matches").findMatchesForPlayer(match.guildId, interaction.user.id)) {
    await refreshMatchMessage(interaction.client, other);
  }
  return replyOk(interaction, summary);
}

module.exports = {
  actionJoin, actionWaitlist, actionLeave, actionStart, actionEnd, actionBalance,
  actionClaim, actionMyVoice, actionTeams, actionRefresh, actionLink,
  endMatch, applyBalance, runWarning,
  handleComponent, handleProfileModal,
};
