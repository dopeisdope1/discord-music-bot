const permissionsStore = require("./permissionsStore");
const commandStateStore = require("./commandStateStore");
const { loadAllCommands } = require("./modCommandLoader");
const { effectiveLevel } = require("./accessControl");
const { LEVEL } = require("./permLevels");

/**
 * Rebascule en `configurable` les commandes publiques attachées à une
 * permission.
 *
 * Attacher une commande publique à une permission la restreint (voir
 * utils/modPanelPermissions.js) : le panel la passe en `configurable`, sans
 * quoi elle resterait autorisée avant même que les slots soient consultés.
 * Or ce niveau vit dans commandState.json, qui n'est PAS sauvegardé dans le
 * salon zinki-config — il est commun à tous les serveurs, alors que le salon
 * est par serveur — et disparaît donc à chaque redéploiement Railway. La
 * commande redeviendrait publique en silence tout en restant affichée dans la
 * permission.
 *
 * Les permissions, elles, sont bien sauvegardées : elles suffisent à
 * reconstituer l'information au démarrage, sans dépendre d'un Volume monté.
 *
 * @returns {string[]} les commandes effectivement rebasculées
 */
function restorePublicRestrictions(guildId) {
  const attached = new Set();
  for (const slot of permissionsStore.listByGuild(guildId)) {
    for (const name of slot.commands) attached.add(name);
  }

  const registry = loadAllCommands();
  const restored = [];

  for (const name of attached) {
    const command = registry.get(name);
    // Commande disparue du bot depuis, ou déjà restreinte : rien à faire.
    if (!command || effectiveLevel(command) !== LEVEL.PUBLIC) continue;
    commandStateStore.setLevel(name, LEVEL.CONFIGURABLE);
    restored.push(name);
  }

  return restored;
}

module.exports = { restorePublicRestrictions };
