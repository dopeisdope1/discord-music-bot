const { AuditLogEvent, PermissionFlagsBits, ChannelType } = require("discord.js");
const { sendLog } = require("./actionLogger");
const { isEnabled, isOwner, isWhitelistedFor } = require("./antiNukeStore");
const { MODULE_LABELS, ALL_MODULES } = require("./antiNukeModules");

// Fenêtre glissante par défaut : au-delà du seuil d'un module (voir
// THRESHOLDS), on considère que c'est un nuke (ou une tentative) et pas de
// la modération normale. Certains modules (permission Administrateur sur un
// rôle, ajout d'un bot, désactivation des niveaux de boost...) se
// déclenchent dès la 1ère fois — seuil 1, pas besoin de répétition.
const WINDOW_MS = 10_000;
const THRESHOLDS = {
  channelCreate: 3,
  channelDelete: 3,
  channelUpdate: 5,
  channelPermissionUpdate: 5,
  threadCreate: 5,
  threadDelete: 3,
  threadUpdate: 5,
  categoryCreate: 3,
  categoryDelete: 3,
  categoryUpdate: 5,
  categoryPermissionUpdate: 5,
  roleCreate: 3,
  roleDelete: 3,
  roleUpdate: 5,
  roleAdminGrant: 1,
  eventCreate: 5,
  eventUpdate: 5,
  eventDelete: 3,
  ban: 3,
  kick: 3,
  timeout: 5,
  nickname: 8,
  voiceDisconnect: 5,
  voiceMove: 5,
  voiceMuteDeafen: 5,
  webhookCreate: 2,
  botAdd: 1,
  massRoleRemoval: 5,
  guildUpdate: 3,
  boostLevelDisable: 1,
};

// Map<"guildId:userId:module", timestamp[]>
const activity = new Map();

function recordAndCheck(guildId, userId, moduleKey) {
  const key = `${guildId}:${userId}:${moduleKey}`;
  const now = Date.now();
  const timestamps = (activity.get(key) || []).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  activity.set(key, timestamps);
  return timestamps.length >= THRESHOLDS[moduleKey];
}

// Fenêtre dédiée au retrait de rôles en masse : ici on ne compte pas des
// occurrences d'un même type d'action, mais le nombre de MEMBRES DISTINCTS
// touchés par le même exécuteur retirant le même rôle en peu de temps.
const MASS_ROLE_WINDOW_MS = 15_000;
const MASS_ROLE_THRESHOLD = 5;
// Map<"guildId:executorId:roleId", { members: Set<string>, firstSeen: number }>
const massRoleTracking = new Map();

function recordMassRoleRemoval(guildId, executorId, roleId, memberId) {
  const key = `${guildId}:${executorId}:${roleId}`;
  const now = Date.now();
  let entry = massRoleTracking.get(key);
  if (!entry || now - entry.firstSeen > MASS_ROLE_WINDOW_MS) {
    entry = { members: new Set(), firstSeen: now };
    massRoleTracking.set(key, entry);
  }
  entry.members.add(memberId);
  return entry.members.size >= MASS_ROLE_THRESHOLD;
}

function isExempt(guild, userId, moduleKey) {
  // Jamais le propriétaire, le bot lui-même, un "owner" anti-nuke (voir
  // =owner) ni un membre whitelisté pour ce module précis (voir =wl).
  return (
    userId === guild.ownerId ||
    userId === guild.client.user.id ||
    isOwner(guild, userId) ||
    isWhitelistedFor(guild.id, userId, moduleKey)
  );
}

/**
 * Cherche qui a fait l'action correspondante il y a moins de quelques
 * secondes : les events gateway bruts n'incluent jamais l'exécuteur, seuls
 * les logs d'audit l'ont — même principe que fetchBanExecutors dans
 * utils/banPanel.js. Si l'action a été faite PAR LE BOT (ex: `.massrole`,
 * `.banall`, rôles créés/supprimés via `.panel`), l'exécuteur retourné est
 * le bot lui-même — c'est filtré par l'appelant (executor.bot), ce qui
 * exempte naturellement toutes nos propres commandes de modération sans
 * avoir besoin d'une liste d'exceptions.
 * @param {import('discord.js').Guild} guild
 * @param {number} auditLogType
 * @param {string} [targetId]
 * @returns {Promise<import('discord.js').User|null>}
 */
async function findExecutor(guild, auditLogType, targetId) {
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;
  const logs = await guild.fetchAuditLogs({ type: auditLogType, limit: 5 }).catch(() => null);
  if (!logs) return null;
  const entry = [...logs.entries.values()].find(
    (e) => (!targetId || e.target?.id === targetId) && Date.now() - e.createdTimestamp < 8000
  );
  return entry?.executor || null;
}

/**
 * Neutralise le responsable en lui retirant tous ses rôles (hors @everyone
 * et rôles gérés par une intégration) — réversible (un admin peut les
 * redonner ensuite), contrairement à un kick/ban qui ne l'est pas.
 * @param {import('discord.js').Guild} guild
 * @param {string} userId
 * @param {string} moduleKey
 * @param {string} reason
 */
async function punish(guild, userId, moduleKey, reason) {
  if (isExempt(guild, userId, moduleKey)) return;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || !member.manageable) return;

  const rolesToRemove = member.roles.cache.filter((r) => r.id !== guild.id && !r.managed);
  if (rolesToRemove.size === 0) return;

  const removed = await member.roles
    .remove(rolesToRemove, `[Anti-nuke] ${reason}`)
    .then(() => true)
    .catch((err) => {
      console.error("[antiNuke] Impossible de retirer les rôles :", err);
      return false;
    });
  if (!removed) return;

  console.warn(`[antiNuke] "${member.user.tag}" neutralisé sur "${guild.name}" — ${reason}`);
  sendLog(guild.client, guild.id, "securite", {
    title: "🚨 Anti-nuke déclenché",
    description: reason,
    actor: member.user,
    fields: [
      { name: "Module", value: MODULE_LABELS[moduleKey] || moduleKey, inline: true },
      { name: "Action", value: "Tous les rôles retirés", inline: true },
    ],
  });
}

/**
 * Point d'entrée générique pour un module "simple" : rate-limité ou instant
 * (voir THRESHOLDS), résolution de l'exécuteur via les logs d'audit.
 * @param {import('discord.js').Guild} guild
 * @param {string} moduleKey
 * @param {number} auditLogType
 * @param {string|undefined} targetId
 * @param {string} reason
 */
async function detect(guild, moduleKey, auditLogType, targetId, reason) {
  if (!isEnabled(guild.id)) return;
  const executor = await findExecutor(guild, auditLogType, targetId);
  if (!executor || executor.bot) return;

  const threshold = THRESHOLDS[moduleKey] ?? 1;
  const shouldPunish = threshold <= 1 ? true : recordAndCheck(guild.id, executor.id, moduleKey);
  if (shouldPunish) {
    await punish(guild, executor.id, moduleKey, reason);
  }
}

/**
 * Protection "anti-nuke" (dite "antifast") : détecte les rafales d'actions
 * destructrices sur une vingtaine de modules (salons, catégories, rôles,
 * événements, membres, serveur, webhooks/bots — voir utils/antiNukeModules.js
 * pour la liste complète) et neutralise automatiquement le responsable
 * (retrait de tous ses rôles) si ce n'est ni le propriétaire du serveur, ni
 * le bot, ni un "owner"/whitelisté anti-nuke pour ce module précis (voir
 * utils/antiNukeStore.js et les commandes `=antifast`/`=owner`/`=wl`).
 * Activable/désactivable par serveur via `=antifast on|off`. Toute action
 * faite par le bot lui-même (`.massrole`, `.banall`, rôles créés/supprimés
 * via `.panel`...) est ignorée automatiquement, l'exécuteur relevé dans les
 * logs d'audit étant le bot et non la personne qui a tapé la commande.
 * @param {import('discord.js').Client} client
 */
function registerAntiNuke(client) {
  // ---- Salons / catégories (mêmes events gateway, distingués par type) ----
  client.on("channelCreate", async (channel) => {
    if (!channel.guild) return;
    const isCategory = channel.type === ChannelType.GuildCategory;
    await detect(
      channel.guild,
      isCategory ? "categoryCreate" : "channelCreate",
      AuditLogEvent.ChannelCreate,
      channel.id,
      `Création de ${THRESHOLDS[isCategory ? "categoryCreate" : "channelCreate"]}+ ${isCategory ? "catégories" : "salons"} en moins de ${WINDOW_MS / 1000}s`
    );
  });

  client.on("channelDelete", async (channel) => {
    if (!channel.guild) return;
    const isCategory = channel.type === ChannelType.GuildCategory;
    await detect(
      channel.guild,
      isCategory ? "categoryDelete" : "channelDelete",
      AuditLogEvent.ChannelDelete,
      channel.id,
      `Suppression de ${THRESHOLDS[isCategory ? "categoryDelete" : "channelDelete"]}+ ${isCategory ? "catégories" : "salons"} en moins de ${WINDOW_MS / 1000}s`
    );
  });

  client.on("channelUpdate", async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;
    const isCategory = newChannel.type === ChannelType.GuildCategory;
    const permsChanged =
      oldChannel.permissionOverwrites?.cache.size !== newChannel.permissionOverwrites?.cache.size ||
      [...(newChannel.permissionOverwrites?.cache.values() ?? [])].some((overwrite) => {
        const old = oldChannel.permissionOverwrites?.cache.get(overwrite.id);
        return !old || old.allow.bitfield !== overwrite.allow.bitfield || old.deny.bitfield !== overwrite.deny.bitfield;
      });

    // Glisser-déposer un salon dans la liste décale la position de PLEIN
    // d'autres salons d'un coup, chacun déclenchant son propre channelUpdate
    // — un réordonnancement normal fait à la main, pas un signal de nuke. On
    // ignore si RIEN d'autre que la position (et les permissions, déjà
    // traitées séparément) n'a changé.
    if (
      !permsChanged &&
      oldChannel.name === newChannel.name &&
      oldChannel.topic === newChannel.topic &&
      oldChannel.nsfw === newChannel.nsfw &&
      oldChannel.parentId === newChannel.parentId &&
      oldChannel.bitrate === newChannel.bitrate &&
      oldChannel.userLimit === newChannel.userLimit &&
      oldChannel.rateLimitPerUser === newChannel.rateLimitPerUser
    ) {
      return;
    }

    if (permsChanged) {
      const moduleKey = isCategory ? "categoryPermissionUpdate" : "channelPermissionUpdate";
      await detect(
        newChannel.guild,
        moduleKey,
        AuditLogEvent.ChannelOverwriteUpdate,
        newChannel.id,
        `Modification des permissions de ${THRESHOLDS[moduleKey]}+ ${isCategory ? "catégories" : "salons"} en moins de ${WINDOW_MS / 1000}s`
      );
      return;
    }

    const moduleKey = isCategory ? "categoryUpdate" : "channelUpdate";
    await detect(
      newChannel.guild,
      moduleKey,
      AuditLogEvent.ChannelUpdate,
      newChannel.id,
      `Modification de ${THRESHOLDS[moduleKey]}+ ${isCategory ? "catégories" : "salons"} en moins de ${WINDOW_MS / 1000}s`
    );
  });

  // ---- Threads ----
  client.on("threadCreate", async (thread) => {
    if (!thread.guild) return;
    await detect(thread.guild, "threadCreate", AuditLogEvent.ThreadCreate, thread.id, `Création de ${THRESHOLDS.threadCreate}+ threads en moins de ${WINDOW_MS / 1000}s`);
  });
  client.on("threadDelete", async (thread) => {
    if (!thread.guild) return;
    await detect(thread.guild, "threadDelete", AuditLogEvent.ThreadDelete, thread.id, `Suppression de ${THRESHOLDS.threadDelete}+ threads en moins de ${WINDOW_MS / 1000}s`);
  });
  client.on("threadUpdate", async (oldThread, newThread) => {
    if (!newThread.guild) return;
    if (oldThread.name === newThread.name && oldThread.archived === newThread.archived && oldThread.locked === newThread.locked) return;
    await detect(newThread.guild, "threadUpdate", AuditLogEvent.ThreadUpdate, newThread.id, `Modification de ${THRESHOLDS.threadUpdate}+ threads en moins de ${WINDOW_MS / 1000}s`);
  });

  // ---- Rôles ----
  client.on("roleDelete", async (role) => {
    await detect(role.guild, "roleDelete", AuditLogEvent.RoleDelete, role.id, `Suppression de ${THRESHOLDS.roleDelete}+ rôles en moins de ${WINDOW_MS / 1000}s`);
  });

  client.on("roleCreate", async (role) => {
    await detect(role.guild, "roleCreate", AuditLogEvent.RoleCreate, role.id, `Création de ${THRESHOLDS.roleCreate}+ rôles en moins de ${WINDOW_MS / 1000}s`);
  });

  client.on("roleUpdate", async (oldRole, newRole) => {
    const gainedAdmin = !oldRole.permissions.has(PermissionFlagsBits.Administrator) && newRole.permissions.has(PermissionFlagsBits.Administrator);
    if (gainedAdmin) {
      await detect(newRole.guild, "roleAdminGrant", AuditLogEvent.RoleUpdate, newRole.id, `A donné la permission Administrateur au rôle **${newRole.name}**`);
      return;
    }

    // Glisser-déposer un rôle dans la hiérarchie décale la position de PLEIN
    // d'autres rôles d'un coup, chacun déclenchant son propre roleUpdate —
    // un réordonnancement normal fait à la main (ou via .panel > Rôles), pas
    // un signal de nuke. On ignore si RIEN d'autre que la position n'a changé.
    const onlyPositionChanged =
      oldRole.name === newRole.name &&
      oldRole.color === newRole.color &&
      oldRole.hoist === newRole.hoist &&
      oldRole.mentionable === newRole.mentionable &&
      oldRole.icon === newRole.icon &&
      oldRole.permissions.bitfield === newRole.permissions.bitfield;
    if (onlyPositionChanged) return;

    await detect(newRole.guild, "roleUpdate", AuditLogEvent.RoleUpdate, newRole.id, `Modification de ${THRESHOLDS.roleUpdate}+ rôles en moins de ${WINDOW_MS / 1000}s`);
  });

  // ---- Événements planifiés ----
  client.on("guildScheduledEventCreate", async (event) => {
    await detect(event.guild, "eventCreate", AuditLogEvent.GuildScheduledEventCreate, event.id, `Création de ${THRESHOLDS.eventCreate}+ événements en moins de ${WINDOW_MS / 1000}s`);
  });
  client.on("guildScheduledEventUpdate", async (oldEvent, newEvent) => {
    await detect(newEvent.guild, "eventUpdate", AuditLogEvent.GuildScheduledEventUpdate, newEvent.id, `Modification de ${THRESHOLDS.eventUpdate}+ événements en moins de ${WINDOW_MS / 1000}s`);
  });
  client.on("guildScheduledEventDelete", async (event) => {
    await detect(event.guild, "eventDelete", AuditLogEvent.GuildScheduledEventDelete, event.id, `Suppression de ${THRESHOLDS.eventDelete}+ événements en moins de ${WINDOW_MS / 1000}s`);
  });

  // ---- Membres : ban/kick ----
  client.on("guildBanAdd", async (ban) => {
    await detect(ban.guild, "ban", AuditLogEvent.MemberBanAdd, ban.user.id, `${THRESHOLDS.ban}+ bannissements en moins de ${WINDOW_MS / 1000}s`);
  });

  client.on("guildMemberRemove", async (member) => {
    await detect(member.guild, "kick", AuditLogEvent.MemberKick, member.id, `${THRESHOLDS.kick}+ expulsions en moins de ${WINDOW_MS / 1000}s`);
  });

  // ---- Membres : timeout, pseudo, retrait de rôles en masse ----
  client.on("guildMemberUpdate", async (oldMember, newMember) => {
    const guild = newMember.guild;
    if (!isEnabled(guild.id)) return;

    if (oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp) {
      const isNewTimeout = newMember.communicationDisabledUntilTimestamp && newMember.communicationDisabledUntilTimestamp > Date.now();
      if (isNewTimeout) {
        await detect(guild, "timeout", AuditLogEvent.MemberUpdate, newMember.id, `${THRESHOLDS.timeout}+ timeouts en moins de ${WINDOW_MS / 1000}s`);
      }
    }

    if (oldMember.nickname !== newMember.nickname) {
      await detect(guild, "nickname", AuditLogEvent.MemberUpdate, newMember.id, `${THRESHOLDS.nickname}+ changements de pseudo en moins de ${WINDOW_MS / 1000}s`);
    }

    const removedRoles = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id));
    if (removedRoles.size > 0) {
      const executor = await findExecutor(guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
      if (executor && !executor.bot) {
        for (const role of removedRoles.values()) {
          if (recordMassRoleRemoval(guild.id, executor.id, role.id, newMember.id)) {
            await punish(
              guild,
              executor.id,
              "massRoleRemoval",
              `Retrait du rôle **${role.name}** à ${MASS_ROLE_THRESHOLD}+ membres en moins de ${MASS_ROLE_WINDOW_MS / 1000}s`
            );
          }
        }
      }
    }
  });

  // ---- Voix : déconnexion, déplacement, mute/sourdine serveur ----
  client.on("voiceStateUpdate", async (oldState, newState) => {
    const guild = newState.guild;
    if (!isEnabled(guild.id)) return;

    if (oldState.channelId && !newState.channelId) {
      await detect(guild, "voiceDisconnect", AuditLogEvent.MemberDisconnect, undefined, `${THRESHOLDS.voiceDisconnect}+ déconnexions vocales forcées en moins de ${WINDOW_MS / 1000}s`);
    } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
      await detect(guild, "voiceMove", AuditLogEvent.MemberMove, undefined, `${THRESHOLDS.voiceMove}+ déplacements vocaux forcés en moins de ${WINDOW_MS / 1000}s`);
    }

    if (oldState.serverMute !== newState.serverMute || oldState.serverDeaf !== newState.serverDeaf) {
      await detect(guild, "voiceMuteDeafen", AuditLogEvent.MemberUpdate, newState.member?.id, `${THRESHOLDS.voiceMuteDeafen}+ mute/sourdine serveur en moins de ${WINDOW_MS / 1000}s`);
    }
  });

  // ---- Webhooks / bots ----
  client.on("webhooksUpdate", async (channel) => {
    if (!channel.guild) return;
    await detect(channel.guild, "webhookCreate", AuditLogEvent.WebhookCreate, undefined, `Création de ${THRESHOLDS.webhookCreate}+ webhooks en moins de ${WINDOW_MS / 1000}s`);
  });

  client.on("guildMemberAdd", async (member) => {
    if (!member.user.bot) return;
    await detect(member.guild, "botAdd", AuditLogEvent.BotAdd, member.id, `A ajouté le bot **${member.user.tag}**`);
  });

  // ---- Serveur ----
  client.on("guildUpdate", async (oldGuild, newGuild) => {
    if (oldGuild.premiumProgressBarEnabled && !newGuild.premiumProgressBarEnabled) {
      await detect(newGuild, "boostLevelDisable", AuditLogEvent.GuildUpdate, newGuild.id, "A désactivé la barre de progression des boosts du serveur");
      return;
    }
    await detect(newGuild, "guildUpdate", AuditLogEvent.GuildUpdate, newGuild.id, `${THRESHOLDS.guildUpdate}+ modifications des paramètres du serveur en moins de ${WINDOW_MS / 1000}s`);
  });

  console.log(`🛡️ Anti-nuke ("antifast") activé — ${ALL_MODULES.length} modules surveillés.`);
}

module.exports = { registerAntiNuke };
