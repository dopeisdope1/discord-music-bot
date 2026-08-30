const fs = require("fs");
const path = require("path");

// Rôle de mute (distinct du timeout natif Discord, voir &mute/&tempmute) +
// suivi des mutes temporaires pour les lever automatiquement à l'échéance.
// Le rôle lui-même doit être configuré manuellement dans Discord pour
// refuser Envoyer des messages/Parler sur les salons — comme la plupart des
// bots de modération, le bot ne gère que l'attribution/retrait du rôle.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const ROLE_FILE = path.join(DATA_DIR, "muteRoles.json");
const TEMP_FILE = path.join(DATA_DIR, "tempMutes.json");

let roleCache = null;
let tempCache = null;

function loadRoles() {
  if (roleCache) return roleCache;
  try {
    roleCache = JSON.parse(fs.readFileSync(ROLE_FILE, "utf8"));
  } catch {
    roleCache = {};
  }
  return roleCache;
}
function saveRoles() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(ROLE_FILE, JSON.stringify(roleCache, null, 2));
  } catch (err) {
    console.error("[muteStore] échec de la sauvegarde (rôle) :", err);
  }
}

function loadTemp() {
  if (tempCache) return tempCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(TEMP_FILE, "utf8"));
    tempCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    tempCache = [];
  }
  return tempCache;
}
function saveTemp() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TEMP_FILE, JSON.stringify(tempCache, null, 2));
  } catch (err) {
    console.error("[muteStore] échec de la sauvegarde (temp) :", err);
  }
}

function getMuteRoleId(guildId) {
  return loadRoles()[guildId] || null;
}
function setMuteRoleId(guildId, roleId) {
  loadRoles()[guildId] = roleId;
  saveRoles();
}

function addTempMute(guildId, userId, expiresAt) {
  const list = loadTemp().filter((m) => !(m.guildId === guildId && m.userId === userId));
  list.push({ guildId, userId, expiresAt });
  tempCache = list;
  saveTemp();
}
function removeTempMute(guildId, userId) {
  tempCache = loadTemp().filter((m) => !(m.guildId === guildId && m.userId === userId));
  saveTemp();
}
function clearTempMutes(guildId) {
  tempCache = loadTemp().filter((m) => m.guildId !== guildId);
  saveTemp();
}

/** Mutes temporaires dont l'échéance est dépassée — à traiter puis retirer via removeTempMute. */
function getExpiredTempMutes() {
  const now = Date.now();
  return loadTemp().filter((m) => m.expiresAt <= now);
}

module.exports = { getMuteRoleId, setMuteRoleId, addTempMute, removeTempMute, clearTempMutes, getExpiredTempMutes };
