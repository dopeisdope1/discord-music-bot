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

function tables() {
  if (!cache) {
    const { MOD_COMMAND_NAMES, MOD_SUBCOMMANDS } = require("./musicCommands");
    cache = { names: new Set(MOD_COMMAND_NAMES), subcommands: MOD_SUBCOMMANDS };
  }
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

  const { names, subcommands } = tables();
  const mots = command.name.trim().split(/\s+/);
  const base = mots[0].toLowerCase().replace(/[<[|].*$/, "");
  if (!names.has(base)) return false;

  // Un deuxième mot ORDINAIRE ("set modlogs") désigne une sous-commande ; un
  // paramètre ("mute <membre>", "clear [nombre]") désigne la commande de base,
  // qui est bien celle qu'on vient de trouver.
  const second = (mots[1] || "").toLowerCase();
  if (!second || !/^[a-z]+$/.test(second)) return true;

  // Le deuxième mot est un vrai mot : la commande doit le router pour que la
  // ligne documentée corresponde à quelque chose.
  return Boolean(subcommands[base]?.includes(second));
}

module.exports = { isImplemented };
