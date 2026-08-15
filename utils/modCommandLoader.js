const fs = require("fs");
const path = require("path");

const COMMANDS_DIR = path.join(__dirname, "..", "modcommands");

let cache = null;

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.name.endsWith(".js")) files.push(full);
  }
  return files;
}

function loadAllCommands() {
  if (cache) return cache;

  const registry = new Map();
  for (const file of walk(COMMANDS_DIR)) {
    const mod = require(file);
    if (!mod || typeof mod.name !== "string" || typeof mod.execute !== "function") {
      console.warn(`[modCommandLoader] fichier de commande invalide ignoré : ${file}`);
      continue;
    }
    if (registry.has(mod.name)) {
      console.warn(`[modCommandLoader] nom de commande en double "${mod.name}" dans ${file}`);
    }
    registry.set(mod.name, mod);
    for (const alias of mod.aliases || []) registry.set(alias, mod);
  }

  cache = registry;
  return cache;
}

module.exports = { loadAllCommands, COMMANDS_DIR };
