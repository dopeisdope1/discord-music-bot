const fs = require("fs");
const path = require("path");
const { report } = require("../moderation/actions");
const { isWhitelisted } = require("./antiSpam");
const { ecrireJson, lireJson } = require("../jsonFile");

// Mots interdits : supprime tout message contenant un mot de la liste
// (comparaison insensible à la casse, sur les limites de mot). Pas de
// sanction automatique au-delà de la suppression — une liste configurable
// par serveur est trop sujette aux faux positifs pour justifier un timeout,
// contrairement à l'anti-spam/l'anti-mass-mention. Même famille d'automod,
// même whitelist.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "badWords.json");

const DEFAULT_CONFIG = { enabled: false };

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
    console.error("[badWords] échec de la sauvegarde :", err);
  }
}

function guildEntry(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = { ...DEFAULT_CONFIG, words: [] };
  if (!data[guildId].words) data[guildId].words = [];
  return data[guildId];
}

function getConfig(guildId) {
  const { words, ...config } = guildEntry(guildId);
  return config;
}

function getWords(guildId) {
  return [...guildEntry(guildId).words];
}

function setEnabled(guildId, enabled) {
  guildEntry(guildId).enabled = enabled;
  save();
}

/** @returns {boolean} false si le mot y était déjà */
function addWord(guildId, word) {
  const entry = guildEntry(guildId);
  const normalized = word.toLowerCase().trim();
  if (!normalized || entry.words.includes(normalized)) return false;
  entry.words.push(normalized);
  save();
  return true;
}

/** @returns {boolean} false si le mot n'y était pas */
function removeWord(guildId, word) {
  const entry = guildEntry(guildId);
  const normalized = word.toLowerCase().trim();
  if (!entry.words.includes(normalized)) return false;
  entry.words = entry.words.filter((w) => w !== normalized);
  save();
  return true;
}

function clearWords(guildId) {
  guildEntry(guildId).words = [];
  save();
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

  const words = getWords(message.guild.id);
  if (!words.length) return;
  if (isWhitelisted(message.member)) return;

  const content = message.content.toLowerCase();
  const matched = words.find((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(content));
  if (!matched) return;
  if (!message.deletable) return;

  await message.delete().catch(() => {});

  await report(client, {
    guildId: message.guild.id,
    category: "moderation",
    title: "Mot interdit",
    fields: [
      { label: "Cible", value: `<@${message.author.id}> (${message.author.id})` },
      { label: "Salon", value: `<#${message.channel.id}>` },
      { label: "Mot", value: `\`${matched}\`` },
    ],
    action: "automod-badword",
    targetId: message.author.id,
    targetTag: message.author.tag,
    moderator: client.user,
    channelId: message.channel.id,
  });
}

module.exports = {
  getConfig,
  getWords,
  setEnabled,
  addWord,
  removeWord,
  clearWords,
  checkMessage,
};
