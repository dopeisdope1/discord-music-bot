const fs = require("fs");
const path = require("path");

// Tickets : un salon "annonce" (message + bouton "Ouvrir un ticket"), un
// rôle staff qui voit les tickets ouverts, et le suivi des tickets ouverts
// (pour savoir qui peut les fermer).
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const CONFIG_FILE = path.join(DATA_DIR, "ticketConfig.json");
const OPEN_FILE = path.join(DATA_DIR, "openTickets.json");

let configCache = null;
let openCache = null;

function loadConfig() {
  if (configCache) return configCache;
  try {
    configCache = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch {
    configCache = {};
  }
  return configCache;
}
function saveConfig() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(configCache, null, 2));
  } catch (err) {
    console.error("[ticketStore] échec de la sauvegarde (config) :", err);
  }
}

function loadOpen() {
  if (openCache) return openCache;
  try {
    openCache = JSON.parse(fs.readFileSync(OPEN_FILE, "utf8"));
  } catch {
    openCache = {};
  }
  return openCache;
}
function saveOpen() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(OPEN_FILE, JSON.stringify(openCache, null, 2));
  } catch (err) {
    console.error("[ticketStore] échec de la sauvegarde (ouverts) :", err);
  }
}

/**
 * Réglages d'un serveur. Les champs ajoutés après coup ont un défaut qui
 * reproduit l'ancien comportement, pour qu'une configuration déjà enregistrée
 * continue de fonctionner à l'identique :
 *  - `closeRoleId` vide  -> c'est le rôle staff qui ferme, comme avant ;
 *  - `ownerCanClose` absent -> `true`, le demandeur pouvait déjà fermer ;
 *  - `categoryId` vide   -> le salon est créé à la racine, comme avant.
 * @returns {{ staffRoleId: string|null, closeRoleId: string|null, categoryId: string|null, ownerCanClose: boolean }}
 */
function getConfig(guildId) {
  const brut = loadConfig()[guildId] || {};
  return {
    staffRoleId: brut.staffRoleId || null,
    closeRoleId: brut.closeRoleId || null,
    categoryId: brut.categoryId || null,
    ownerCanClose: brut.ownerCanClose !== false,
  };
}

/** Écrit un ou plusieurs réglages sans écraser les autres. */
function setConfig(guildId, patch) {
  const data = loadConfig();
  data[guildId] = { ...(data[guildId] || {}), ...patch };
  saveConfig();
}

function setStaffRole(guildId, roleId) {
  setConfig(guildId, { staffRoleId: roleId || null });
}

function registerOpenTicket(channelId, guildId, ownerId) {
  loadOpen()[channelId] = { guildId, ownerId };
  saveOpen();
}

function getTicketInfo(channelId) {
  return loadOpen()[channelId] || null;
}

function unregisterTicket(channelId) {
  const data = loadOpen();
  if (!data[channelId]) return false;
  delete data[channelId];
  saveOpen();
  return true;
}

module.exports = { getConfig, setConfig, setStaffRole, registerOpenTicket, getTicketInfo, unregisterTicket };
