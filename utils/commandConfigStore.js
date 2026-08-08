const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "commandConfig.json");

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
 * @returns {{ allowedRoleIds: string[], deniedRoleIds: string[], allowedChannelIds: string[] }}
 */
function getCommandConfig(guildId, command) {
  const all = loadAll();
  return (
    all[guildId]?.[command] || { allowedRoleIds: [], deniedRoleIds: [], allowedChannelIds: [] }
  );
}

function updateCommandConfig(guildId, command, updates) {
  const all = loadAll();
  all[guildId] = all[guildId] || {};
  all[guildId][command] = { ...getCommandConfig(guildId, command), ...updates };
  saveAll(all);
  return all[guildId][command];
}

function resetCommandConfig(guildId, command) {
  const all = loadAll();
  if (all[guildId]) delete all[guildId][command];
  saveAll(all);
}

/**
 * @returns {Record<string, { allowedRoleIds: string[], deniedRoleIds: string[], allowedChannelIds: string[] }>}
 */
function getGuildCommandConfigs(guildId) {
  return loadAll()[guildId] || {};
}

module.exports = { getCommandConfig, updateCommandConfig, resetCommandConfig, getGuildCommandConfigs };
