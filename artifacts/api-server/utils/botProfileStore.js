const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Présence/profil du bot — GLOBAL (pas par serveur : un bot n'a qu'un seul
// statut/activité, partagé sur tous les serveurs où il se trouve).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "botProfile.json");

const DEFAULT_CONFIG = { status: "online", activityType: null, activities: [], rotateIndex: 0 };

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = { ...DEFAULT_CONFIG, ...lireJson(DATA_FILE) };
  } catch {
    cache = { ...DEFAULT_CONFIG };
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ecrireJson(DATA_FILE, cache);
  } catch (err) {
    console.error("[botProfileStore] échec de la sauvegarde :", err);
  }
}

function getConfig() {
  return { ...load() };
}

function setStatus(status) {
  load().status = status;
  save();
}

/** @param {string} type "Playing"|"Listening"|"Watching"|"Competing"|"Streaming" @param {string[]} texts */
function setActivities(type, texts) {
  const data = load();
  data.activityType = type;
  data.activities = texts;
  data.rotateIndex = 0;
  save();
}

function clearActivity() {
  const data = load();
  data.activityType = null;
  data.activities = [];
  data.rotateIndex = 0;
  save();
}

/** Fait avancer la rotation d'un cran et retourne l'activité à afficher maintenant (ou null si aucune configurée). */
function nextActivity() {
  const data = load();
  if (!data.activities.length) return null;
  const text = data.activities[data.rotateIndex % data.activities.length];
  data.rotateIndex = (data.rotateIndex + 1) % data.activities.length;
  save();
  return { type: data.activityType, text };
}

module.exports = { getConfig, setStatus, setActivities, clearActivity, nextActivity };
