const { ChannelType, PermissionFlagsBits } = require("discord.js");
const accessStore = require("../accessStore");
const { botAndRankRefusal } = require("../moderation/actions");
const { postModerationEntry } = require("../moderationLog");
const historyStore = require("../moderationHistoryStore");
const guardConfig = require("./config");
const guardWhitelist = require("./whitelist");

// Moteur générique de l'anti-nuke (Phase 1 du plan) : chaque guard
// (utils/guard/definitions.js) déclare un événement d'audit, un seuil
// (nombre d'occurrences dans une fenêtre — null = immédiat, réservé aux
// actions les plus dangereuses) et, pour les actions simplement
// inversibles (ban/unban), une fonction `revert`. Pas de restauration de
// structure (salon/rôle recréé à l'identique) en v1 — voir le plan pour
// pourquoi ce choix.
//
// Owner/rang sys/whitelist sont EXEMPTÉS EN ENTIER (pas juste de la
// sanction) : leurs actions légitimes et rapides ne doivent ni compter
// dans un seuil, ni être annulées, ni déclencher quoi que ce soit — même
// principe que le rang sys ailleurs dans le bot.

// Occurrences par (guilde, exécuteur, guard), pour les seuils "en rafale".
// En mémoire uniquement : une fenêtre de quelques secondes n'a pas besoin
// de survivre à un redémarrage.
const occurrences = new Map();

function recordOccurrence(guildId, executorId, guardKey, windowMs) {
  const key = `${guildId}:${executorId}:${guardKey}`;
  const now = Date.now();
  const list = (occurrences.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  occurrences.set(key, list);
  return list.length;
}

function clearOccurrences(guildId, executorId, guardKey) {
  occurrences.delete(`${guildId}:${executorId}:${guardKey}`);
}

// Plafond de sanctions par serveur, par minute glissante : évite que le
// moteur, en pleine réponse à un vrai raid, ne parte lui-même dans une
// rafale de kicks/bans qui ressemblerait à un nuke aux yeux du CrowBot
// (voir le plan, section "risque à signaler").
const MAX_PUNISHMENTS_PER_MINUTE = 5;
const punishmentLog = new Map();

function punishmentCapReached(guildId) {
  const now = Date.now();
  const list = (punishmentLog.get(guildId) || []).filter((t) => now - t < 60_000);
  punishmentLog.set(guildId, list);
  return list.length >= MAX_PUNISHMENTS_PER_MINUTE;
}

function recordPunishment(guildId) {
  const list = punishmentLog.get(guildId) || [];
  list.push(Date.now());
  punishmentLog.set(guildId, list);
}

// Un seul verrouillage automatique par rafale : sans ce garde-fou, CHAQUE
// entrée d'audit qui arrive une fois le plafond atteint retenterait de
// verrouiller (déjà verrouillé) tous les salons en boucle. Remis à zéro par
// &unlockdown (voir moderationCommands.js) pour qu'un futur vrai raid
// puisse à nouveau déclencher le verrouillage.
const autoLockedDown = new Set();

/**
 * "&antinuke autolockdown on" (voir utils/guard/config.js) : au lieu de se
 * contenter d'ignorer les sanctions une fois le plafond atteint, verrouille
 * tout le serveur une fois — le signal qu'un vrai raid est en cours, pas
 * juste un guard isolé qui se déclenche.
 */
async function autoLockdownIfNeeded(client, guild, config) {
  if (!config.autoLockdownOnCap || autoLockedDown.has(guild.id)) return;
  autoLockedDown.add(guild.id);

  const everyone = guild.roles.everyone;
  const channels = guild.channels.cache.filter(
    (c) => (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) && c.manageable
  );
  let locked = 0;
  for (const channel of channels.values()) {
    const already = channel.permissionOverwrites.cache.get(everyone.id)?.deny.has(PermissionFlagsBits.SendMessages);
    if (already) continue;
    await channel.permissionOverwrites
      .edit(everyone, { SendMessages: false }, { reason: "Anti-nuke : verrouillage automatique (plafond de sanctions atteint)" })
      .catch(() => {});
    locked += 1;
  }

  await postModerationEntry(client, guild.id, "moderation", {
    title: "Anti-nuke — Verrouillage automatique",
    fields: [{ label: "Salons verrouillés", value: String(locked) }],
    moderatorTag: "Anti-nuke (automatique)",
  });
  historyStore.record({
    guildId: guild.id,
    action: "lockdown",
    moderatorId: client.user.id,
    moderatorTag: client.user.tag,
    reason: "Anti-nuke : plafond de sanctions atteint",
    source: "bot",
  });
}

function clearAutoLockdown(guildId) {
  autoLockedDown.delete(guildId);
}

/** Vrai si `member` doit être totalement ignoré par le moteur (pas seulement épargné de la sanction). */
function isFullyExempt(member) {
  if (!member) return false;
  if (accessStore.isOwner(member.id) || accessStore.isAllowed("sys", member.id)) return true;
  return guardWhitelist.isWhitelisted(member);
}

async function applyPunishment(client, guild, executorMember, config, reason) {
  if (!executorMember || executorMember.id === client.user.id) return false;
  // Protections déjà éprouvées ailleurs (owner du serveur/du bot, rang
  // sys, hiérarchie du bot) — réutilisées telles quelles, pas de seconde
  // implémentation des mêmes règles.
  if (botAndRankRefusal(guild, executorMember)) return false;

  try {
    if (config.punishment === "ban") await executorMember.ban({ reason });
    else if (config.punishment === "kick") await executorMember.kick(reason);
    else await executorMember.timeout(config.punishmentDurationMs, reason);
    return true;
  } catch (err) {
    console.error(`[guard] échec de la sanction sur ${executorMember.id} :`, err.message);
    return false;
  }
}

/**
 * Traite une entrée du journal d'audit Discord pour UN guard donné (voir
 * utils/guard/definitions.js pour la liste et leurs seuils). Ne fait rien
 * si l'anti-nuke est désactivé, si l'exécuteur est ce bot lui-même, ou s'il
 * est totalement exempté (owner/sys/whitelist).
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildAuditLogsEntry} entry
 * @param {object} guardDef voir utils/guard/definitions.js
 */
async function handleAuditEntry(client, guild, entry, guardDef) {
  const config = guardConfig.getConfig(guild.id);
  if (!guardConfig.isGuardEnabled(guild.id, guardDef.key)) return;
  if (entry.executorId === client.user.id) return;

  const executorMember = entry.executorId ? await guild.members.fetch(entry.executorId).catch(() => null) : null;
  if (isFullyExempt(executorMember)) return;

  let triggered;
  if (!guardDef.threshold) {
    triggered = true;
  } else {
    const count = recordOccurrence(guild.id, entry.executorId, guardDef.key, guardDef.threshold.windowMs);
    triggered = count >= guardDef.threshold.count;
    if (triggered) clearOccurrences(guild.id, entry.executorId, guardDef.key);
  }
  if (!triggered) return;

  if (guardDef.revert) {
    await guardDef.revert(entry, guild).catch((err) => console.error(`[guard] échec de la restauration (${guardDef.key}) :`, err.message));
  }

  const capped = punishmentCapReached(guild.id);
  if (capped) {
    console.warn(`[guard] plafond de sanctions atteint sur "${guild.name}", "${guardDef.key}" ignoré cette fois (log conservé).`);
    await autoLockdownIfNeeded(client, guild, config).catch((err) => console.error("[guard] échec du verrouillage automatique :", err.message));
  }
  const punished = capped ? false : await applyPunishment(client, guild, executorMember, config, `Anti-nuke : ${guardDef.label}`);
  if (punished) recordPunishment(guild.id);

  await postModerationEntry(client, guild.id, "moderation", {
    title: `Anti-nuke — ${guardDef.label}`,
    fields: [
      {
        label: "Exécuteur",
        value: executorMember ? `<@${executorMember.id}> (${executorMember.id})` : `\`${entry.executorId || "inconnu"}\``,
      },
      { label: "Sanction", value: punished ? config.punishment : "aucune (protégé, ou plafond de sanctions atteint)" },
    ],
    moderatorTag: "Anti-nuke (automatique)",
    pingRoleId: config.pingRoleId,
  });

  historyStore.record({
    guildId: guild.id,
    action: `guard_${guardDef.key}`,
    targetId: entry.executorId || null,
    targetTag: executorMember?.user.tag || null,
    moderatorId: client.user.id,
    moderatorTag: client.user.tag,
    reason: `Anti-nuke : ${guardDef.label}`,
    source: "bot",
  });
}

module.exports = {
  handleAuditEntry,
  isFullyExempt,
  applyPunishment,
  recordOccurrence,
  clearOccurrences,
  punishmentCapReached,
  recordPunishment,
  autoLockdownIfNeeded,
  clearAutoLockdown,
};
