const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Compteurs de serveur : un salon dont le NOM affiche un nombre tenu à jour
// (membres, humains, bots, boosts). Le salon est en lecture seule pour
// @everyone — il ne sert qu'à afficher.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "counters.json");

// Quatre compteurs suffisent, et chacun se calcule à partir du cache des
// membres SANS requête supplémentaire. « En ligne » est volontairement
// absent : il changerait des dizaines de fois par heure alors que Discord
// n'autorise que deux renommages par salon et par tranche de 10 minutes — le
// compteur afficherait donc en permanence une valeur périmée, en donnant
// l'illusion du direct.
const TYPES = {
  membres: { label: "Membres", modele: "Membres : {n}" },
  humains: { label: "Humains", modele: "Humains : {n}" },
  bots: { label: "Bots", modele: "Bots : {n}" },
  boosts: { label: "Boosts", modele: "Boosts : {n}" },
};

const MAX_PAR_SERVEUR = 6;

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
    console.error("[counterStore] échec de la sauvegarde :", err);
  }
}

function guildList(guildId) {
  const data = load();
  if (!Array.isArray(data[guildId])) data[guildId] = [];
  return data[guildId];
}

/** @returns {{channelId: string, type: string, modele: string}[]} */
function list(guildId) {
  return [...guildList(guildId)];
}

/** Tous les serveurs ayant au moins un compteur — pour le balayage périodique. */
function guildIds() {
  return Object.keys(load()).filter((id) => guildList(id).length);
}

/**
 * @returns {{ok: true}|{ok: false, motif: string}}
 */
function add(guildId, channelId, type, modele) {
  if (!TYPES[type]) return { ok: false, motif: `Type inconnu. Choisis parmi : ${Object.keys(TYPES).join(", ")}.` };
  const liste = guildList(guildId);
  if (liste.some((c) => c.channelId === channelId)) {
    return { ok: false, motif: "Ce salon est déjà un compteur." };
  }
  if (liste.length >= MAX_PAR_SERVEUR) {
    return { ok: false, motif: `Limite atteinte : ${MAX_PAR_SERVEUR} compteurs par serveur.` };
  }
  const propre = String(modele || TYPES[type].modele).trim().slice(0, 90);
  if (!propre.includes("{n}")) {
    return { ok: false, motif: "Le modèle doit contenir `{n}`, remplacé par le nombre." };
  }
  liste.push({ channelId, type, modele: propre });
  save();
  return { ok: true };
}

/** @returns {boolean} false si ce salon n'était pas un compteur. */
function remove(guildId, channelId) {
  const liste = guildList(guildId);
  const index = liste.findIndex((c) => c.channelId === channelId);
  if (index === -1) return false;
  liste.splice(index, 1);
  save();
  return true;
}

/**
 * Retire les compteurs dont le salon n'existe plus.
 * @returns {number} nombre d'entrées oubliées
 */
function nettoyer(guildId, salonExiste) {
  const liste = guildList(guildId);
  const avant = liste.length;
  const restants = liste.filter((c) => salonExiste(c.channelId));
  if (restants.length === avant) return 0;
  load()[guildId] = restants;
  save();
  return avant - restants.length;
}

/**
 * La valeur d'un compteur, depuis le cache de la guilde — aucune requête.
 * @returns {number|null} `null` si le type est inconnu
 */
function valeur(type, guild) {
  const membres = guild?.members?.cache;
  switch (type) {
    case "membres":
      // `memberCount` vient de Discord et reste juste même si le cache des
      // membres est incomplet ; les autres comptages, eux, en dépendent.
      return typeof guild?.memberCount === "number" ? guild.memberCount : membres?.size ?? null;
    case "humains":
      return membres ? membres.filter((m) => !m.user?.bot).size : null;
    case "bots":
      return membres ? membres.filter((m) => m.user?.bot).size : null;
    case "boosts":
      return guild?.premiumSubscriptionCount ?? 0;
    default:
      return null;
  }
}

/** Le nom que le salon devrait porter. */
function nomAttendu(compteur, guild) {
  const n = valeur(compteur.type, guild);
  if (n === null) return null;
  return compteur.modele.replace("{n}", n.toLocaleString("fr-FR")).slice(0, 100);
}

module.exports = { TYPES, MAX_PAR_SERVEUR, list, guildIds, add, remove, nettoyer, valeur, nomAttendu };
