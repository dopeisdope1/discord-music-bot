const fs = require("fs");
const path = require("path");
const { AuditLogEvent: A, PermissionFlagsBits } = require("discord.js");
const { ecrireJson, lireJson } = require("./jsonFile");
const accessStore = require("./accessStore");

// Page « Protections » du panel. Un seul moteur pour toutes les protections :
//  - "audit"   : N actions d'un même membre en X secondes (journal d'audit) ;
//  - "message" : contrôle de chaque message (liens, spam, mentions...) ;
//  - "join"    : contrôle des arrivées (anti-alt).
// Propriétaires, Sys du bot, propriétaire du serveur et le bot lui-même sont exemptés.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "protections.json");

const SANCTIONS = ["none", "timeout", "strip_roles", "kick", "ban"];
const SANCTION_LABELS = { none: "Aucune, log seulement", timeout: "Timeout", strip_roles: "Retirer les rôles", kick: "Expulser", ban: "Bannir" };
const DANGEROUS = [
  PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels, PermissionFlagsBits.BanMembers, PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageWebhooks, PermissionFlagsBits.MentionEveryone,
];

const hasChange = (entry, key) => entry.changes?.some((c) => c.key === key);
const addsDangerous = (entry, guild) =>
  (entry.changes || []).some((c) => c.key === "$add" && (c.new || []).some((r) => guild.roles.cache.get(r.id)?.permissions.any(DANGEROUS)));

// kind "audit" : `match(entry, guild)` filtre en plus du type d'action.
const audit = (id, label, category, actions, d, match) => ({ id, label, category, kind: "audit", actions: [].concat(actions), match, defaults: d });
const DEF = { count: 3, seconds: 10, sanction: "ban" };
const DEFS = [
  // Sanctions en série
  audit("ban", "Anti-ban", "Sanctions en série", A.MemberBanAdd, DEF),
  audit("kick", "Anti-kick", "Sanctions en série", A.MemberKick, DEF),
  audit("timeout", "Anti-timeout", "Sanctions en série", A.MemberUpdate, { ...DEF, count: 5 }, (e) => hasChange(e, "communication_disabled_until")),
  // Salons
  audit("channel-create", "Anti-création de salon", "Salons", A.ChannelCreate, { ...DEF, count: 5 }),
  audit("channel-delete", "Anti-suppression de salon", "Salons", A.ChannelDelete, { ...DEF, count: 5 }),
  audit("channel-update", "Anti-modification de salon", "Salons", A.ChannelUpdate, { ...DEF, count: 8 }),
  // Rôles et permissions
  audit("role-create", "Anti-création de rôle", "Rôles et permissions", A.RoleCreate, { ...DEF, count: 5 }),
  audit("role-delete", "Anti-suppression de rôle", "Rôles et permissions", A.RoleDelete, { ...DEF, count: 3 }),
  audit("role-update", "Anti-modification de rôle", "Rôles et permissions", A.RoleUpdate, { ...DEF, count: 8 }),
  audit("role-add", "Anti-ajout de rôle", "Rôles et permissions", A.MemberRoleUpdate, { ...DEF, count: 8 }, (e) => hasChange(e, "$add")),
  audit("role-remove", "Anti-retrait de rôle", "Rôles et permissions", A.MemberRoleUpdate, { ...DEF, count: 8 }, (e) => hasChange(e, "$remove")),
  audit("role-mass", "Anti-rôle de masse", "Rôles et permissions", A.MemberRoleUpdate, { ...DEF, count: 1, seconds: 60 }, (e, g) => addsDangerous(e, g)),
  // Bots et intégrations
  audit("bot", "Anti-bot", "Bots et intégrations", A.BotAdd, { ...DEF, count: 1, sanction: "ban" }),
  audit("webhook", "Anti-webhook", "Bots et intégrations", A.WebhookCreate, { ...DEF, count: 3 }),
  audit("thread", "Anti-thread", "Bots et intégrations", A.ThreadCreate, { ...DEF, count: 10, sanction: "timeout" }),
  // Vocal
  audit("voice-mute", "Anti-mute vocal", "Vocal", A.MemberUpdate, { ...DEF, count: 5, sanction: "timeout" }, (e) => hasChange(e, "mute")),
  audit("voice-deafen", "Anti-sourdine vocal", "Vocal", A.MemberUpdate, { ...DEF, count: 5, sanction: "timeout" }, (e) => hasChange(e, "deaf")),
  audit("voice-disconnect", "Anti-déconnexion vocale", "Vocal", A.MemberDisconnect, { ...DEF, count: 5, sanction: "timeout" }),
  audit("voice-move", "Anti-déplacement vocal", "Vocal", A.MemberMove, { ...DEF, count: 5, sanction: "timeout" }),
  // Serveur
  audit("guild-update", "Anti-modification du serveur", "Serveur", A.GuildUpdate, { ...DEF, count: 3 }),
  audit("expression", "Anti-expression", "Serveur", [A.EmojiDelete, A.StickerDelete], { ...DEF, count: 5 }),
  // Messages
  { id: "link", label: "Anti-lien", category: "Messages", kind: "message", defaults: { sanction: "timeout", count: 1, seconds: 10 }, test: (m) => /(https?:\/\/|discord\.gg\/|www\.)\S+/i.test(m.content) },
  { id: "spam", label: "Anti-spam", category: "Messages", kind: "message", windowed: true, defaults: { sanction: "timeout", count: 5, seconds: 5 }, test: () => true },
  { id: "badword", label: "Anti-BadWord", category: "Messages", kind: "message", defaults: { sanction: "timeout", count: 1, seconds: 10, words: [] }, test: (m, cfg) => (cfg.words || []).some((w) => w && m.content.toLowerCase().includes(w.toLowerCase())) },
  { id: "mention-members", label: "Anti-mention membres", category: "Messages", kind: "message", defaults: { sanction: "timeout", count: 5, seconds: 10 }, test: (m, cfg) => m.mentions.users.size >= cfg.count },
  { id: "mention-roles", label: "Anti-mention rôles", category: "Messages", kind: "message", defaults: { sanction: "timeout", count: 3, seconds: 10 }, test: (m, cfg) => m.mentions.roles.size >= cfg.count },
  { id: "mention-everyone", label: "Anti-mention @everyone", category: "Messages", kind: "message", defaults: { sanction: "timeout", count: 1, seconds: 10 }, test: (m) => /@(everyone|here)/.test(m.content) },
  { id: "token-grab", label: "Anti-token grab", category: "Messages", kind: "message", defaults: { sanction: "ban", count: 1, seconds: 10 }, test: (m) => /[\w-]{24,28}\.[\w-]{6}\.[\w-]{27,38}|discord(app)?\.com\/api\/webhooks\//.test(m.content) },
  // Arrivées
  { id: "alt", label: "Anti-alt", category: "Arrivées", kind: "join", defaults: { sanction: "kick", count: 1, seconds: 10, minAgeDays: 7 } },
];
for (const d of DEFS) d.key = `anti-${d.id}`;
const BY_KEY = new Map(DEFS.map((d) => [d.key, d]));
const COMMON = { enabled: false, lockServer: false, logChannelId: null };

let cache = null;
function load() {
  if (cache) return cache;
  try { cache = lireJson(DATA_FILE); } catch { cache = {}; }
  return cache;
}
function save() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); ecrireJson(DATA_FILE, cache); }
  catch (err) { console.error("[protections] échec de la sauvegarde :", err); }
}

function getConfig(guildId, key) {
  const def = BY_KEY.get(key);
  return { ...COMMON, ...def.defaults, ...(load()[guildId]?.[key] || {}) };
}

function setConfig(guildId, key, patch = {}) {
  const def = BY_KEY.get(key);
  const next = getConfig(guildId, key);
  if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
  if (Number.isInteger(patch.count)) next.count = Math.min(50, Math.max(1, patch.count));
  if (Number.isInteger(patch.seconds)) next.seconds = Math.min(3600, Math.max(1, patch.seconds));
  if (SANCTIONS.includes(patch.sanction)) next.sanction = patch.sanction;
  if (typeof patch.lockServer === "boolean") next.lockServer = patch.lockServer;
  if (patch.logChannelId === null || typeof patch.logChannelId === "string") next.logChannelId = patch.logChannelId || null;
  if (def.defaults.words && Array.isArray(patch.words)) next.words = patch.words.filter((w) => typeof w === "string").slice(0, 200);
  if (def.defaults.minAgeDays && Number.isInteger(patch.minAgeDays)) next.minAgeDays = Math.min(365, Math.max(1, patch.minAgeDays));
  const data = load();
  (data[guildId] ||= {})[key] = next;
  save();
  return next;
}

// "guildId:key:userId" -> horodatages (ms) récents.
const recent = new Map();
/** Enregistre une action ; true si le seuil est atteint (compteur remis à zéro). */
function record(guildId, key, userId, now = Date.now()) {
  const cfg = getConfig(guildId, key);
  if (!cfg.enabled) return false;
  const id = `${guildId}:${key}:${userId}`;
  const times = (recent.get(id) || []).filter((t) => now - t < cfg.seconds * 1000);
  times.push(now);
  if (times.length >= cfg.count) { recent.delete(id); return true; }
  recent.set(id, times);
  return false;
}

const exempt = (guild, userId) =>
  userId === guild.client.user.id || userId === guild.ownerId || accessStore.isOwner(userId) || accessStore.isSys(userId);

async function lockServer(guild) {
  let changed = 0;
  for (const role of guild.roles.cache.values()) {
    if (role.managed || !role.editable || !role.permissions.any(DANGEROUS)) continue;
    await role.setPermissions(role.permissions.remove(DANGEROUS), "Protection : verrouillage du serveur").then(() => changed++).catch(() => {});
  }
  return changed;
}

async function punish(guild, userId, sanction, reason) {
  const ok = (p) => p.then(() => true).catch(() => false);
  if (sanction === "ban") return ok(guild.members.ban(userId, { reason }));
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || sanction === "none") return false;
  if (sanction === "kick") return ok(member.kick(reason));
  if (sanction === "timeout") return ok(member.timeout(60 * 60 * 1000, reason));
  if (sanction === "strip_roles") return ok(member.roles.set([], reason));
  return false;
}

async function trigger(guild, def, cfg, userId, detail) {
  const reason = `${def.label} : ${detail}`;
  const punished = cfg.sanction === "none" ? null : await punish(guild, userId, cfg.sanction, reason);
  const locked = cfg.lockServer ? await lockServer(guild) : null;
  const ch = cfg.logChannelId && guild.channels.cache.get(cfg.logChannelId);
  if (!ch?.isTextBased()) return;
  const lines = [`🛡️ **${def.label}** — <@${userId}> : ${detail}.`,
    `Sanction : **${SANCTION_LABELS[cfg.sanction]}**${punished === null ? "" : punished ? " (appliquée)" : " (échec : permissions insuffisantes ?)"}`];
  if (locked !== null) lines.push(`Serveur verrouillé : ${locked} rôle(s) restreint(s).`);
  await ch.send({ content: lines.join("\n"), allowedMentions: { parse: [] } }).catch(() => {});
}

/** Événement `guildAuditLogEntryCreate`. */
async function handleAuditEntry(entry, guild) {
  const userId = entry.executorId;
  if (!userId || exempt(guild, userId)) return;
  for (const def of DEFS) {
    if (def.kind !== "audit" || !def.actions.includes(entry.action)) continue;
    const cfg = getConfig(guild.id, def.key);
    if (!cfg.enabled || (def.match && !def.match(entry, guild))) continue;
    if (record(guild.id, def.key, userId)) await trigger(guild, def, cfg, userId, `${cfg.count} action(s) en moins de ${cfg.seconds} s`);
  }
}

/** Événement `messageCreate`. */
async function handleMessage(message) {
  const guild = message.guild;
  if (!guild || message.author.bot || exempt(guild, message.author.id)) return;
  for (const def of DEFS) {
    if (def.kind !== "message") continue;
    const cfg = getConfig(guild.id, def.key);
    if (!cfg.enabled || !def.test(message, cfg)) continue;
    // Spam / liens : seuil sur la fenêtre ; les autres se déclenchent dès le message fautif.
    if ((def.windowed || def.id === "link") && !record(guild.id, def.key, message.author.id)) continue;
    await message.delete().catch(() => {});
    await trigger(guild, def, cfg, message.author.id, "message supprimé");
  }
}

/** Événement `guildMemberAdd` (anti-alt). */
async function handleJoin(member) {
  const def = BY_KEY.get("anti-alt");
  const cfg = getConfig(member.guild.id, def.key);
  if (!cfg.enabled || exempt(member.guild, member.id)) return;
  const ageDays = (Date.now() - member.user.createdTimestamp) / 86_400_000;
  if (ageDays < cfg.minAgeDays) await trigger(member.guild, def, cfg, member.id, `compte créé il y a ${Math.floor(ageDays)} j (minimum ${cfg.minAgeDays} j)`);
}

const split = (full) => { const { enabled, ...config } = full; return { enabled, config, updatedAt: null }; };
/** Entrées pour la liste `systems` du panel (GET/PATCH /systems/:guildId). */
const systems = DEFS.map((def) => ({
  key: def.key,
  label: def.label,
  description: `Protection « ${def.label} ».`,
  icon: "shield",
  category: def.category,
  getState: (guildId) => split(getConfig(guildId, def.key)),
  setState(guildId, patch) {
    return split(setConfig(guildId, def.key, { ...(patch.config || {}), ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}) }));
  },
}));

module.exports = { DEFS, systems, getConfig, setConfig, record, handleAuditEntry, handleMessage, handleJoin, SANCTIONS, SANCTION_LABELS };
