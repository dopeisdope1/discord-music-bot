const fs = require("fs");
const path = require("path");
const { AuditLogEvent, PermissionFlagsBits } = require("discord.js");
const { ecrireJson, lireJson } = require("./jsonFile");
const accessStore = require("./accessStore");

// Protection « Anti-suppression de salon » (page Protections du panel).
//
// Si un même membre supprime `count` salons en moins de `seconds` secondes,
// le bot applique la sanction choisie à l'auteur, peut verrouiller le serveur
// (retire les permissions dangereuses de tous les rôles) et publie une alerte
// dans le salon de log. Propriétaires et Sys du bot sont exemptés.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "antiChannelDelete.json");

const SANCTIONS = ["none", "timeout", "strip_roles", "kick", "ban"];
const SANCTION_LABELS = {
  none: "Aucune, log seulement",
  timeout: "Timeout",
  strip_roles: "Retirer les rôles",
  kick: "Expulser",
  ban: "Bannir",
};
const DEFAULTS = { enabled: false, count: 5, seconds: 10, sanction: "ban", lockServer: false, logChannelId: null };
const TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;
const DANGEROUS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.MentionEveryone,
];

let cache = null;
function load() {
  if (cache) return cache;
  try {
    cache = lireJson(DATA_FILE);
  } catch {
    cache = {};
  }
  return cache;
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ecrireJson(DATA_FILE, cache);
  } catch (err) {
    console.error("[antiChannelDelete] échec de la sauvegarde :", err);
  }
}

function getConfig(guildId) {
  return { ...DEFAULTS, ...(load()[guildId] || {}) };
}

/** Applique un patch partiel ({ enabled?, count?, seconds?, sanction?, lockServer?, logChannelId? }) en validant chaque champ. */
function setConfig(guildId, patch = {}) {
  const next = getConfig(guildId);
  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
  if (Number.isInteger(patch.count)) next.count = Math.min(50, Math.max(1, patch.count));
  if (Number.isInteger(patch.seconds)) next.seconds = Math.min(3600, Math.max(1, patch.seconds));
  if (SANCTIONS.includes(patch.sanction)) next.sanction = patch.sanction;
  if (typeof patch.lockServer === "boolean") next.lockServer = patch.lockServer;
  if (patch.logChannelId === null || typeof patch.logChannelId === "string") next.logChannelId = patch.logChannelId || null;
  load()[guildId] = next;
  save();
  return next;
}

// guildId -> userId -> timestamps (ms) des suppressions récentes.
const recent = new Map();

/** Enregistre une suppression ; renvoie true si le seuil est atteint (et remet le compteur à zéro). */
function recordDeletion(guildId, userId, now = Date.now()) {
  const cfg = getConfig(guildId);
  if (!cfg.enabled) return false;
  const key = `${guildId}:${userId}`;
  const times = (recent.get(key) || []).filter((t) => now - t < cfg.seconds * 1000);
  times.push(now);
  if (times.length >= cfg.count) {
    recent.delete(key);
    return true;
  }
  recent.set(key, times);
  return false;
}

async function lockServer(guild) {
  let changed = 0;
  for (const role of guild.roles.cache.values()) {
    if (role.managed || !role.editable || !role.permissions.any(DANGEROUS)) continue;
    const kept = role.permissions.remove(DANGEROUS);
    await role.setPermissions(kept, "Anti-suppression de salon : verrouillage du serveur").then(() => changed++).catch(() => {});
  }
  return changed;
}

async function punish(guild, member, userId, sanction) {
  const reason = "Anti-suppression de salon";
  if (sanction === "ban") return guild.members.ban(userId, { reason }).then(() => true).catch(() => false);
  if (!member) return false;
  if (sanction === "kick") return member.kick(reason).then(() => true).catch(() => false);
  if (sanction === "timeout") return member.timeout(TIMEOUT_MS, reason).then(() => true).catch(() => false);
  if (sanction === "strip_roles") {
    return member.roles.set([], reason).then(() => true).catch(() => false);
  }
  return false;
}

/** À appeler depuis l'événement `channelDelete`. */
async function handleChannelDelete(channel) {
  const guild = channel.guild;
  if (!guild) return;
  const cfg = getConfig(guild.id);
  if (!cfg.enabled) return;

  const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.ChannelDelete, limit: 5 }).catch(() => null);
  const entry = logs?.entries.find((e) => e.target?.id === channel.id && Date.now() - e.createdTimestamp < 10_000);
  const executor = entry?.executor;
  if (!executor || executor.id === guild.client.user.id) return;
  if (accessStore.isOwner(executor.id) || accessStore.isSys(executor.id) || executor.id === guild.ownerId) return;
  if (!recordDeletion(guild.id, executor.id)) return;

  const member = await guild.members.fetch(executor.id).catch(() => null);
  const punished = cfg.sanction === "none" ? false : await punish(guild, member, executor.id, cfg.sanction);
  const locked = cfg.lockServer ? await lockServer(guild) : null;

  const logChannel = cfg.logChannelId && guild.channels.cache.get(cfg.logChannelId);
  if (logChannel?.isTextBased()) {
    const lines = [
      `🛡️ **Anti-suppression de salon** — <@${executor.id}> a supprimé ${cfg.count} salons en moins de ${cfg.seconds} s.`,
      `Sanction : **${SANCTION_LABELS[cfg.sanction]}**${cfg.sanction !== "none" ? (punished ? " (appliquée)" : " (échec : permissions insuffisantes ?)") : ""}`,
    ];
    if (locked !== null) lines.push(`Serveur verrouillé : ${locked} rôle(s) restreint(s).`);
    await logChannel.send({ content: lines.join("\n"), allowedMentions: { parse: [] } }).catch(() => {});
  }
}

/** Entrée pour la liste `systems` du panel (GET/PATCH /systems/:guildId). */
const system = {
  key: "anti-channel-delete",
  label: "Anti-suppression de salon",
  description: "Sanctionne un membre qui supprime plusieurs salons en peu de temps.",
  icon: "shield",
  category: "Protections",
  getState(guildId) {
    const { enabled, ...config } = getConfig(guildId);
    return { enabled, config, updatedAt: null };
  },
  setState(guildId, patch) {
    const next = setConfig(guildId, { ...(patch.config || {}), ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}) });
    const { enabled, ...config } = next;
    return { enabled, config, updatedAt: null };
  },
};

module.exports = { getConfig, setConfig, recordDeletion, handleChannelDelete, system, SANCTIONS, SANCTION_LABELS };
