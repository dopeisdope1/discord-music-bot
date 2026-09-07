const fs = require("fs");
const path = require("path");
const { report } = require("../moderation/actions");
const { isWhitelisted } = require("./antiSpam");

// Anti-mass-mention léger : timeout d'un membre qui mentionne trop de monde
// dans un seul message (utilisateurs + rôles cumulés). Même famille
// d'automod que l'anti-spam, même whitelist.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "antiMention.json");

const DEFAULT_CONFIG = { enabled: false, maxMentions: 5, timeoutSeconds: 60 };

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
    console.error("[antiMention] échec de la sauvegarde :", err);
  }
}

function guildEntry(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = { ...DEFAULT_CONFIG };
  return data[guildId];
}

function getConfig(guildId) {
  return { ...guildEntry(guildId) };
}

function setEnabled(guildId, enabled) {
  guildEntry(guildId).enabled = enabled;
  save();
}

function setMaxMentions(guildId, maxMentions) {
  guildEntry(guildId).maxMentions = maxMentions;
  save();
}

/**
 * Durée du timeout appliqué en cas de mass-mention. Bornée pour les mêmes
 * raisons que l'anti-spam : trop court ne sanctionne rien, au-delà de 28
 * jours l'API Discord refuse.
 * @returns {number|null} la valeur retenue, ou null si hors bornes
 */
function setTimeoutSeconds(guildId, seconds) {
  if (!Number.isInteger(seconds) || seconds < 5 || seconds > 28 * 86400) return null;
  guildEntry(guildId).timeoutSeconds = seconds;
  save();
  return seconds;
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

  const count = message.mentions.users.size + message.mentions.roles.size;
  if (count <= config.maxMentions) return;

  if (message.deletable) await message.delete().catch(() => {});

  const member = message.member;
  if (!member.moderatable || member.communicationDisabledUntil) return;

  try {
    await member.timeout(config.timeoutSeconds * 1000, "Anti-mass-mention : trop de mentions dans un message");
  } catch (err) {
    console.error("[antiMention] échec du timeout :", err.message);
    return;
  }

  await report(client, {
    guildId: message.guild.id,
    category: "moderation",
    title: "Anti-mass-mention",
    fields: [
      { label: "Cible", value: `<@${message.author.id}> (${message.author.id})` },
      { label: "Salon", value: `<#${message.channel.id}>` },
      { label: "Durée", value: `${config.timeoutSeconds}s` },
      { label: "Déclencheur", value: `${count} mentions (seuil : ${config.maxMentions})` },
    ],
    action: "automod-antimention",
    targetId: message.author.id,
    targetTag: message.author.tag,
    moderator: client.user,
    channelId: message.channel.id,
    extra: { mentions: count, maxMentions: config.maxMentions },
  });
}

module.exports = {
  getConfig,
  setEnabled,
  setMaxMentions,
  setTimeoutSeconds,
  checkMessage,
};
