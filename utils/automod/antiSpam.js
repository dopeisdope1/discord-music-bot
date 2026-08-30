const fs = require("fs");
const path = require("path");
const { report } = require("../moderation/actions");

// Anti-spam/anti-flood léger (section 22 du cahier des charges) : c'est la
// SEULE brique d'automod ajoutée à ce bot. Anti-lien, anti-@everyone,
// anti-invitation et l'essentiel de l'anti-raid sont déjà couverts par le
// CrowBot du serveur — les dupliquer n'apporterait rien (voir le plan,
// "périmètre volontairement réduit").
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "automod.json");

const DEFAULT_CONFIG = { enabled: false, maxMessages: 6, windowSeconds: 6, timeoutSeconds: 60 };

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error("[antiSpam] échec de la sauvegarde :", err);
  }
}

function guildEntry(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = { ...DEFAULT_CONFIG, whitelist: { users: [], roles: [] } };
  if (!data[guildId].whitelist) data[guildId].whitelist = { users: [], roles: [] };
  return data[guildId];
}

function getConfig(guildId) {
  const { whitelist, ...config } = guildEntry(guildId);
  return config;
}

function getWhitelist(guildId) {
  const wl = guildEntry(guildId).whitelist;
  return { users: [...wl.users], roles: [...wl.roles] };
}

function setEnabled(guildId, enabled) {
  guildEntry(guildId).enabled = enabled;
  save();
}

function addToWhitelist(guildId, kind, id) {
  const list = guildEntry(guildId).whitelist[kind];
  if (list.includes(id)) return false;
  list.push(id);
  save();
  return true;
}

function removeFromWhitelist(guildId, kind, id) {
  const list = guildEntry(guildId).whitelist[kind];
  const index = list.indexOf(id);
  if (index === -1) return false;
  list.splice(index, 1);
  save();
  return true;
}

function isWhitelisted(member) {
  const wl = getWhitelist(member.guild.id);
  if (wl.users.includes(member.id)) return true;
  return member.roles.cache.some((r) => wl.roles.includes(r.id));
}

// Horodatages des derniers messages, PAR (guildId, userId) — purement en
// mémoire : perdre cet état à un redémarrage n'a aucune conséquence, une
// rafale de spam ne survit jamais assez longtemps pour que ça compte.
const recentMessages = new Map();
const keyOf = (guildId, userId) => `${guildId}:${userId}`;

/**
 * À appeler dans messageCreate, pour CHAQUE message d'un serveur (avant ou
 * après le routage des commandes, peu importe : ne fait rien si l'automod
 * est désactivé pour ce serveur).
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Message} message
 */
async function checkMessage(client, message) {
  if (message.author.bot || !message.guild || !message.member) return;

  const config = getConfig(message.guild.id);
  if (!config.enabled) return;
  if (isWhitelisted(message.member)) return;

  const key = keyOf(message.guild.id, message.author.id);
  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const timestamps = (recentMessages.get(key) || []).filter((t) => now - t < windowMs);
  timestamps.push(now);
  recentMessages.set(key, timestamps);

  if (timestamps.length <= config.maxMessages) return;

  recentMessages.delete(key); // évite de redéclencher immédiatement pendant le timeout

  const member = message.member;
  if (!member.moderatable || member.communicationDisabledUntil) return;

  try {
    await member.timeout(config.timeoutSeconds * 1000, "Anti-spam : rafale de messages");
  } catch (err) {
    console.error("[antiSpam] échec du timeout :", err.message);
    return;
  }

  await report(client, {
    guildId: message.guild.id,
    category: "moderation",
    title: "Anti-spam",
    fields: [
      { label: "Cible", value: `<@${message.author.id}> (${message.author.id})` },
      { label: "Durée", value: `${config.timeoutSeconds}s` },
      { label: "Déclencheur", value: `${timestamps.length} messages en ${config.windowSeconds}s` },
    ],
    action: "automod-timeout",
    targetId: message.author.id,
    targetTag: message.author.tag,
    moderator: client.user,
    channelId: message.channel.id,
    extra: { messages: timestamps.length, windowSeconds: config.windowSeconds },
  });
}

module.exports = {
  getConfig,
  getWhitelist,
  setEnabled,
  addToWhitelist,
  removeFromWhitelist,
  isWhitelisted,
  checkMessage,
};
