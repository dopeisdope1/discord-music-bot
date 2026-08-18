"use strict";

const { LEVEL, LEVEL_NAMES } = require("../core/permissions/permissionLevels");
const { loadCommandsForIdentity } = require("../core/commandLoader");

// Paliers affichables, du plus bas au plus haut. NONE (0) est le palier
// "public" : accessible sans aucune configuration.
const LEVELS = [LEVEL.NONE, LEVEL.STAFF, LEVEL.MOD, LEVEL.ADMIN];

// "Public" pour 0, "Permission 1 (Staff)" etc. au-dessus — la numérotation
// est celle attendue par `setperm/delperm <1-3> @role`.
function levelLabel(level) {
    if (level === LEVEL.NONE) return "Public";
    return `Permission ${level} (${LEVEL_NAMES[level]})`;
}

const levelOf = (cmd) => cmd.permLevel ?? LEVEL.NONE;

/** Toutes les commandes de l'identité, dédoublonnées et triées par nom. */
function allCommands(identity) {
    return [...new Set(loadCommandsForIdentity(identity).values())].sort((a, b) => a.name.localeCompare(b.name));
}

/** Map<level, commandes de CE palier exactement>. */
function commandsByLevel(identity) {
    const byLevel = new Map(LEVELS.map((l) => [l, []]));
    for (const cmd of allCommands(identity)) {
        const level = levelOf(cmd);
        if (byLevel.has(level)) byLevel.get(level).push(cmd);
    }
    return byLevel;
}

/**
 * Commandes réellement utilisables par quelqu'un : un palier donne accès au
 * sien ET à tous ceux en dessous (même règle que core/messageRouter.js, qui
 * compare `ctx.permLevel < command.permLevel`). Un owner du bot passe partout.
 */
function usableBy(identity, permLevel, botOwner = false) {
    return allCommands(identity).filter((cmd) => botOwner || permLevel >= levelOf(cmd));
}

module.exports = { LEVELS, levelLabel, levelOf, allCommands, commandsByLevel, usableBy };
