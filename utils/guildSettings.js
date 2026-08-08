const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "guildSettings.json");

function loadAll() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveAll(data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/**
 * @param {string} guildId
 * @returns {{ modRoleIds: string[] }}
 */
function getGuildSettings(guildId) {
  return loadAll()[guildId] || { modRoleIds: [] };
}

/**
 * @param {string} guildId
 * @param {string[]} roleIds
 */
function setModRoleIds(guildId, roleIds) {
  const all = loadAll();
  all[guildId] = { ...(all[guildId] || {}), modRoleIds: roleIds };
  saveAll(all);
}

module.exports = { getGuildSettings, setModRoleIds };
