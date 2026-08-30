const fs = require("fs");
const path = require("path");
const { report } = require("../moderation/actions");
const { isWhitelisted } = require("./antiSpam");

// Anti-lien léger : supprime les messages contenant un lien (invitations
// Discord seules, ou tous les liens selon le mode), avec une liste de
// salons exemptés par serveur. Réutilise la whitelist de l'anti-spam
// (utils/automod/antiSpam.js) — même famille d'automod, même exemption.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "antiLink.json");

const DEFAULT_CONFIG = { enabled: false, mode: "invite" }; // mode: "invite" | "all"

const INVITE_RE = /(discord\.gg|discord(?:app)?\.com\/invite)\/[a-z0-9-]+/i;
const LINK_RE = /https?:\/\/\S+/i;

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
    console.error("[antiLink] échec de la sauvegarde :", err);
  }
}

function guildEntry(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = { ...DEFAULT_CONFIG, allowedChannels: [] };
  if (!data[guildId].allowedChannels) data[guildId].allowedChannels = [];
  return data[guildId];
}

function getConfig(guildId) {
  const { allowedChannels, ...config } = guildEntry(guildId);
  return config;
}

function getAllowedChannels(guildId) {
  return [...guildEntry(guildId).allowedChannels];
}

function setEnabled(guildId, enabled) {
  guildEntry(guildId).enabled = enabled;
  save();
}

function setMode(guildId, mode) {
  guildEntry(guildId).mode = mode === "all" ? "all" : "invite";
  save();
}

/** @returns {boolean} true si le salon est désormais exempté, false s'il ne l'est plus (reset) */
function setChannelAllowed(guildId, channelId, allowed) {
  const entry = guildEntry(guildId);
  const has = entry.allowedChannels.includes(channelId);
  if (allowed && !has) entry.allowedChannels.push(channelId);
  else if (!allowed && has) entry.allowedChannels = entry.allowedChannels.filter((id) => id !== channelId);
  save();
  return allowed;
}

/**
 * À appeler dans messageCreate, pour CHAQUE message d'un serveur.
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Message} message
 */
async function checkMessage(client, message) {
  if (message.author.bot || !message.guild || !message.member) return;

  const config = getConfig(message.guild.id);
  if (!config.enabled) return;
  if (isWhitelisted(message.member)) return;
  if (getAllowedChannels(message.guild.id).includes(message.channel.id)) return;

  const re = config.mode === "all" ? LINK_RE : INVITE_RE;
  if (!re.test(message.content)) return;
  if (!message.deletable) return;

  await message.delete().catch(() => {});

  await report(client, {
    guildId: message.guild.id,
    category: "moderation",
    title: "Anti-lien",
    fields: [
      { label: "Cible", value: `<@${message.author.id}> (${message.author.id})` },
      { label: "Salon", value: `<#${message.channel.id}>` },
      { label: "Mode", value: config.mode === "all" ? "tous les liens" : "invitations Discord" },
    ],
    action: "automod-antilink",
    targetId: message.author.id,
    targetTag: message.author.tag,
    moderator: client.user,
    channelId: message.channel.id,
  });
}

module.exports = {
  getConfig,
  getAllowedChannels,
  setEnabled,
  setMode,
  setChannelAllowed,
  checkMessage,
};
