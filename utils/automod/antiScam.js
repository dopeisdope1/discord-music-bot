const fs = require("fs");
const path = require("path");
const { report } = require("../moderation/actions");
const { isWhitelisted } = require("./antiSpam");
const { ecrireJson, lireJson } = require("../jsonFile");

// Anti-scam léger : supprime les messages contenant un lien de phishing
// connu (faux-nitro, faux Steam) — motifs figés, pas de liste externe à
// maintenir. Même famille qu'utils/automod/antiLink.js (structure de
// fichier identique), même whitelist partagée (utils/automod/antiSpam.js).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const DATA_FILE = path.join(DATA_DIR, "antiScam.json");

const DEFAULT_CONFIG = { enabled: false };

// Vrais domaines — jamais bloqués, peu importe ce qu'ils contiennent.
const DOMAINES_LEGITIMES = [
  "discord.com",
  "discordapp.com",
  "discord.gg",
  "discord.gift",
  "discord.media",
  "steamcommunity.com",
  "steampowered.com",
  "store.steampowered.com",
];

/** Extrait les noms d'hôte de tous les liens http(s) d'un texte — un lien mal formé est ignoré, pas une erreur. */
function extraireHotes(texte) {
  const hotes = [];
  const re = /https?:\/\/[^\s<>]+/gi;
  let m;
  while ((m = re.exec(texte))) {
    try {
      hotes.push(new URL(m[0]).hostname.toLowerCase());
    } catch {
      // lien mal formé — pas un vrai lien à vérifier
    }
  }
  return hotes;
}

function estDomaineLegitime(hote) {
  return DOMAINES_LEGITIMES.some((d) => hote === d || hote.endsWith(`.${d}`));
}

/** Neutralise les substitutions "leet" les plus courantes (0→o, 1/l→i...) avant de chercher un motif connu. */
function normaliserLeet(hote) {
  return hote.replace(/0/g, "o").replace(/1/g, "i").replace(/5/g, "s").replace(/3/g, "e").replace(/4/g, "a").replace(/l/g, "i");
}

/**
 * Un domaine est suspect s'il n'est PAS un vrai domaine Discord/Steam mais
 * imite l'un des deux — faux-nitro ("discord" + "nitro"/"gift") ou faux
 * Steam ("steamcommunity" mal orthographié, ex. "steamcommunlty").
 */
function estDomaineSuspect(hote) {
  if (estDomaineLegitime(hote)) return false;
  const norm = normaliserLeet(hote);
  if (norm.includes("discord") && (norm.includes("nitro") || norm.includes("gift"))) return true;
  if (norm.includes("steamcommun")) return true;
  return false;
}

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
    console.error("[antiScam] échec de la sauvegarde :", err);
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

  if (!extraireHotes(message.content).some(estDomaineSuspect)) return;
  if (!message.deletable) return;

  await message.delete().catch(() => {});

  await report(client, {
    guildId: message.guild.id,
    category: "moderation",
    title: "Anti-scam",
    fields: [
      { label: "Cible", value: `<@${message.author.id}> (${message.author.id})` },
      { label: "Salon", value: `<#${message.channel.id}>` },
    ],
    action: "automod-antiscam",
    targetId: message.author.id,
    targetTag: message.author.tag,
    moderator: client.user,
    channelId: message.channel.id,
  });
}

module.exports = { getConfig, setEnabled, checkMessage };
