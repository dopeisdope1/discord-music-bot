// Répond à une seule question : est-ce que cette entrée du catalogue est
// RÉELLEMENT câblée à un handler, ou seulement documentée ?
//
// Le catalogue (utils/commandCatalog.js) mélange volontairement les deux —
// demande explicite : "intègre tout, même sans backend". Mais les présenter
// à l'identique dans &help revient à promettre des commandes qui restent
// muettes quand on les tape : au 31/08, la moitié des 266 entrées listées.
// D'où cette distinction, qui garde la référence complète tout en disant ce
// qui marche.
//
// Le `require` est fait à l'APPEL, pas au chargement : utils/musicCommands.js
// dépend d'utils/helpPanel.js, qui dépend d'ici — un require en tête de
// fichier fermerait la boucle et renverrait un module vide.
let cache = null;

function names() {
  if (!cache) cache = new Set(require("./musicCommands").MOD_COMMAND_NAMES);
  return cache;
}

/**
 * Le catalogue nomme les commandes avec leur syntaxe ("rolemembers <rôle>",
 * "giveaway start <durée> <lot>") ; la table de dispatch, elle, est indexée
 * sur le PREMIER mot. C'est donc lui qui décide.
 * @param {{ name: string, prefix?: string }} command entrée du catalogue
 */
function isImplemented(command) {
  // Les entrées sans préfixe ("uo clear") ne passent pas par la table du
  // préfixe "&" : elles ont leur propre déclencheur (utils/selfClear.js).
  if (!command.prefix) return true;
  return names().has(command.name.trim().split(/[\s<[|]/)[0].toLowerCase());
}

module.exports = { isImplemented };
