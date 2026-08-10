const { AuditLogEvent, PermissionFlagsBits } = require("discord.js");
const { sendLog } = require("./actionLogger");
const { isEnabled, isOwner, isWhitelisted } = require("./antiNukeStore");

// Fenêtre glissante : au-delà de ce seuil d'actions destructrices du même
// type par le même membre en moins de WINDOW_MS, on considère que c'est un
// nuke (ou une tentative) et pas de la modération normale.
const WINDOW_MS = 10_000;
const THRESHOLDS = {
  roleDelete: 3,
  roleCreate: 3,
  channelDelete: 3,
  channelCreate: 3,
  ban: 3,
  kick: 3,
  webhookCreate: 2,
};

// Map<"guildId:userId:action", timestamp[]>
const activity = new Map();

function recordAndCheck(guildId, userId, action) {
  const key = `${guildId}:${userId}:${action}`;
  const now = Date.now();
  const timestamps = (activity.get(key) || []).filter((t) => now - t < WINDOW_MS);
  timestamps.push(now);
  activity.set(key, timestamps);
  return timestamps.length >= THRESHOLDS[action];
}

function isExempt(guild, userId) {
  // Jamais le propriétaire, le bot lui-même, un "owner" anti-nuke (voir
  // .owner) ni un membre whitelisté (voir .wl).
  return userId === guild.ownerId || userId === guild.client.user.id || isOwner(guild, userId) || isWhitelisted(guild.id, userId);
}

/**
 * Cherche qui a fait l'action correspondante il y a moins de quelques
 * secondes : les events gateway bruts (roleDelete, channelDelete...)
 * n'incluent jamais l'exécuteur, seuls les logs d'audit l'ont — même
 * principe que fetchBanExecutors dans utils/banPanel.js. Si l'action a été
 * faite PAR LE BOT (ex: `.massrole`, `.banall`, création/suppression de rôle
 * via `.panel`), l'exécuteur retourné est le bot lui-même — c'est filtré par
 * l'appelant (executor.bot), ce qui exempte naturellement toutes nos propres
 * commandes de modération sans avoir besoin d'une liste d'exceptions.
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
 * @param {string} reason
 */
async function punish(guild, userId, reason) {
  if (isExempt(guild, userId)) return;
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
    fields: [{ name: "Action", value: "Tous les rôles retirés" }],
  });
}

/**
 * Protection "anti-nuke" (dite "antifast") : détecte les rafales d'actions
 * destructrices — suppression/création de rôles ou de salons, bannissements,
 * expulsions, création de webhooks — ainsi que l'attribution de la
 * permission Administrateur à un rôle, et neutralise automatiquement le
 * responsable (retrait de tous ses rôles) si ce n'est ni le propriétaire du
 * serveur, ni le bot, ni un "owner"/whitelisté anti-nuke (voir
 * utils/antiNukeStore.js et les commandes `.antifast`/`.owner`/`.wl`).
 * Activable/désactivable par serveur via `.antifast on|off` — désactivé,
 * plus aucun listener n'agit (voir isEnabled ci-dessous). Toute action faite
 * par le bot lui-même (`.massrole`, `.banall`, rôles créés/supprimés via
 * `.panel`...) est ignorée automatiquement, l'exécuteur relevé dans les logs
 * d'audit étant le bot et non la personne qui a tapé la commande.
 * @param {import('discord.js').Client} client
 */
function registerAntiNuke(client) {
  client.on("roleDelete", async (role) => {
    if (!isEnabled(role.guild.id)) return;
    const executor = await findExecutor(role.guild, AuditLogEvent.RoleDelete, role.id);
    if (!executor || executor.bot) return;
    if (recordAndCheck(role.guild.id, executor.id, "roleDelete")) {
      await punish(role.guild, executor.id, `Suppression de ${THRESHOLDS.roleDelete}+ rôles en moins de ${WINDOW_MS / 1000}s`);
    }
  });

  client.on("roleCreate", async (role) => {
    if (!isEnabled(role.guild.id)) return;
    const executor = await findExecutor(role.guild, AuditLogEvent.RoleCreate, role.id);
    if (!executor || executor.bot) return;
    if (recordAndCheck(role.guild.id, executor.id, "roleCreate")) {
      await punish(role.guild, executor.id, `Création de ${THRESHOLDS.roleCreate}+ rôles en moins de ${WINDOW_MS / 1000}s`);
    }
  });

  client.on("roleUpdate", async (oldRole, newRole) => {
    if (!isEnabled(newRole.guild.id)) return;
    if (oldRole.permissions.has(PermissionFlagsBits.Administrator) || !newRole.permissions.has(PermissionFlagsBits.Administrator)) {
      return;
    }
    const executor = await findExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    if (!executor || executor.bot) return;
    await punish(newRole.guild, executor.id, `A donné la permission Administrateur au rôle **${newRole.name}**`);
  });

  client.on("channelDelete", async (channel) => {
    if (!channel.guild || !isEnabled(channel.guild.id)) return;
    const executor = await findExecutor(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    if (!executor || executor.bot) return;
    if (recordAndCheck(channel.guild.id, executor.id, "channelDelete")) {
      await punish(channel.guild, executor.id, `Suppression de ${THRESHOLDS.channelDelete}+ salons en moins de ${WINDOW_MS / 1000}s`);
    }
  });

  client.on("channelCreate", async (channel) => {
    if (!channel.guild || !isEnabled(channel.guild.id)) return;
    const executor = await findExecutor(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    if (!executor || executor.bot) return;
    if (recordAndCheck(channel.guild.id, executor.id, "channelCreate")) {
      await punish(channel.guild, executor.id, `Création de ${THRESHOLDS.channelCreate}+ salons en moins de ${WINDOW_MS / 1000}s`);
    }
  });

  client.on("guildBanAdd", async (ban) => {
    if (!isEnabled(ban.guild.id)) return;
    const executor = await findExecutor(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    if (!executor || executor.bot) return;
    if (recordAndCheck(ban.guild.id, executor.id, "ban")) {
      await punish(ban.guild, executor.id, `${THRESHOLDS.ban}+ bannissements en moins de ${WINDOW_MS / 1000}s`);
    }
  });

  client.on("guildMemberRemove", async (member) => {
    if (!isEnabled(member.guild.id)) return;
    const executor = await findExecutor(member.guild, AuditLogEvent.MemberKick, member.id);
    if (!executor || executor.bot) return;
    if (recordAndCheck(member.guild.id, executor.id, "kick")) {
      await punish(member.guild, executor.id, `${THRESHOLDS.kick}+ expulsions en moins de ${WINDOW_MS / 1000}s`);
    }
  });

  client.on("webhooksUpdate", async (channel) => {
    if (!channel.guild || !isEnabled(channel.guild.id)) return;
    const executor = await findExecutor(channel.guild, AuditLogEvent.WebhookCreate);
    if (!executor || executor.bot) return;
    if (recordAndCheck(channel.guild.id, executor.id, "webhookCreate")) {
      await punish(channel.guild, executor.id, `Création de ${THRESHOLDS.webhookCreate}+ webhooks en moins de ${WINDOW_MS / 1000}s`);
    }
  });

  console.log("🛡️ Anti-nuke (\"antifast\") activé.");
}

module.exports = { registerAntiNuke };
