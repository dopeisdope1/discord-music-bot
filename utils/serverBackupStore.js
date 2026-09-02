const fs = require("fs");
const path = require("path");

// Sauvegardes de structure de serveur (&backup) : stockage GLOBAL, pas par
// serveur — tout l'intérêt est de pouvoir sauvegarder depuis un serveur et
// restaurer sur un autre (serveur détruit/banni, migration...).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "serverBackups.json");

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error("[serverBackupStore] échec de la sauvegarde :", err);
  }
}

function getBackup(name) {
  return load()[name.toLowerCase()] || null;
}

function saveBackup(name, data) {
  const store = load();
  store[name.toLowerCase()] = data;
  save();
}

function deleteBackup(name) {
  const store = load();
  const key = name.toLowerCase();
  if (!store[key]) return false;
  delete store[key];
  save();
  return true;
}

function listBackups() {
  return Object.entries(load()).map(([name, data]) => ({
    name,
    sourceGuildName: data.sourceGuildName,
    createdAt: data.createdAt,
    channelCount: (data.uncategorized?.length || 0) + data.categories.reduce((n, c) => n + c.channels.length, 0),
  }));
}

module.exports = { getBackup, saveBackup, deleteBackup, listBackups };
