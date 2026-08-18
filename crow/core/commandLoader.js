"use strict";

const fs = require("node:fs");
const path = require("node:path");

const COMMANDS_DIR = path.join(__dirname, "..", "commands");

function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let files = [];
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files = files.concat(walk(full));
        } else if (entry.name.endsWith(".js")) {
            files.push(full);
        }
    }
    return files;
}

let allCommandsCache = null;

// A command file must export { name, category, execute(ctx), permLevel?, aliases?, description? }.
// category = the folder it lives in under src/commands/, used by identities'
// enabledCategories/enabledCommands/disabledCommands to decide who gets it.
function loadAllCommands() {
    if (allCommandsCache) return allCommandsCache;

    const files = fs.existsSync(COMMANDS_DIR) ? walk(COMMANDS_DIR) : [];
    const commands = [];

    for (const file of files) {
        const mod = require(file);
        if (!mod || !mod.name || !mod.category || typeof mod.execute !== "function") {
            console.warn(`[commandLoader] skipping invalid command file: ${file}`);
            continue;
        }
        commands.push(mod);
    }

    allCommandsCache = commands;
    return commands;
}

function loadCommandsForIdentity(identity) {
    const all = loadAllCommands();
    const enabledCommands = new Set(identity.enabledCommands || []);
    const disabledCommands = new Set(identity.disabledCommands || []);
    const enabledCategories = new Set(identity.enabledCategories || []);

    const selected = all.filter((cmd) => {
        const key = `${cmd.category}:${cmd.name}`;
        if (disabledCommands.has(key)) return false;
        return enabledCategories.has(cmd.category) || enabledCommands.has(key);
    });

    const registry = new Map();
    for (const cmd of selected) {
        if (registry.has(cmd.name)) {
            console.warn(
                `[commandLoader] "${identity.key}": duplicate command name "${cmd.name}" (from ${cmd.category}) overwrites a previous registration — rename one of them.`
            );
        }
        registry.set(cmd.name, cmd);
        for (const alias of cmd.aliases || []) {
            registry.set(alias, cmd);
        }
    }
    return registry;
}

module.exports = { loadAllCommands, loadCommandsForIdentity, COMMANDS_DIR };
