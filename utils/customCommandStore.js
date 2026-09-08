const fs = require("fs");
const path = require("path");

// Commandes personnalisées : un mot -> une réponse texte, par serveur.
// Sert aux réponses qu'on retape sans arrêt (règles, liens, FAQ).
//
// Deux garde-fous vivent ICI plutôt que dans la commande, pour qu'ils
// s'appliquent quel que soit l'appelant (commande texte ou panel) :
//   - un nom ne peut pas MASQUER une commande réelle du bot. Sans ça,
//     quelqu'un créerait `ban` et le vrai `&ban` cesserait de répondre —
//     une panne de modération silencieuse, impossible à diagnostiquer.
//   - le nombre par serveur est borné : le fichier est relu en entier à
//     chaque démarrage, et le VPS n'a que 458 Mo.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "customCommands.json");

const MAX_PAR_SERVEUR = 50;
const MAX_LONGUEUR_NOM = 32;
const MAX_LONGUEUR_REPONSE = 1500;

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    cache = {};
  }
  return cache;
}

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error("[customCommandStore] échec de la sauvegarde :", err);
  }
}

function guildMap(guildId) {
  const data = load();
  if (!data[guildId] || typeof data[guildId] !== "object") data[guildId] = {};
  return data[guildId];
}

/** Normalise un nom : minuscules, sans le préfixe éventuellement collé devant. */
function normaliser(nom) {
  return String(nom || "").trim().toLowerCase().replace(/^[^a-z0-9]+/, "");
}

/**
 * Le nom est-il utilisable ? Renvoie `null` si oui, sinon le motif du refus,
 * rédigé pour être affiché tel quel.
 * @param {string[]} reservees mots déjà pris par une vraie commande du bot
 */
function motifDeRefus(nom, reservees = []) {
  const propre = normaliser(nom);
  if (!propre) return "Indique un nom.";
  if (propre.length > MAX_LONGUEUR_NOM) return `Le nom ne peut pas dépasser ${MAX_LONGUEUR_NOM} caractères.`;
  if (!/^[a-z0-9_-]+$/.test(propre)) return "Le nom ne peut contenir que des lettres, chiffres, `-` et `_`.";
  // Le point qui compte : une commande personnalisée ne doit JAMAIS pouvoir
  // prendre la place d'une vraie commande du bot.
  if (reservees.map((r) => r.toLowerCase()).includes(propre)) {
    return `\`${propre}\` est déjà une commande du bot — choisis un autre nom.`;
  }
  return null;
}

/** @returns {{texte: string, auteurId: string, creeLe: number, utilisations: number}|null} */
function get(guildId, nom) {
  return guildMap(guildId)[normaliser(nom)] || null;
}

/** @returns {{nom: string, texte: string, auteurId: string, creeLe: number, utilisations: number}[]} */
function list(guildId) {
  return Object.entries(guildMap(guildId))
    .map(([nom, valeur]) => ({ nom, ...valeur }))
    .sort((a, b) => a.nom.localeCompare(b.nom));
}

function count(guildId) {
  return Object.keys(guildMap(guildId)).length;
}

/**
 * Crée ou remplace une commande.
 * @returns {{ok: true, remplacee: boolean}|{ok: false, motif: string}}
 */
function set(guildId, nom, texte, auteurId, reservees = []) {
  const propre = normaliser(nom);
  const refus = motifDeRefus(propre, reservees);
  if (refus) return { ok: false, motif: refus };

  const contenu = String(texte || "").trim();
  if (!contenu) return { ok: false, motif: "Indique le texte de la réponse." };
  if (contenu.length > MAX_LONGUEUR_REPONSE) {
    return { ok: false, motif: `La réponse ne peut pas dépasser ${MAX_LONGUEUR_REPONSE} caractères.` };
  }

  const map = guildMap(guildId);
  const remplacee = Boolean(map[propre]);
  if (!remplacee && Object.keys(map).length >= MAX_PAR_SERVEUR) {
    return { ok: false, motif: `Limite atteinte : ${MAX_PAR_SERVEUR} commandes personnalisées par serveur.` };
  }

  map[propre] = {
    texte: contenu,
    auteurId: String(auteurId || ""),
    creeLe: remplacee ? map[propre].creeLe : Date.now(),
    utilisations: remplacee ? map[propre].utilisations || 0 : 0,
  };
  save();
  return { ok: true, remplacee };
}

/** @returns {boolean} false si la commande n'existait pas. */
function remove(guildId, nom) {
  const map = guildMap(guildId);
  const propre = normaliser(nom);
  if (!map[propre]) return false;
  delete map[propre];
  save();
  return true;
}

/** Incrémente le compteur d'utilisation, sans jamais faire échouer l'appel. */
function noterUtilisation(guildId, nom) {
  const entree = guildMap(guildId)[normaliser(nom)];
  if (!entree) return;
  entree.utilisations = (entree.utilisations || 0) + 1;
  save();
}

module.exports = {
  get,
  list,
  set,
  remove,
  count,
  noterUtilisation,
  normaliser,
  motifDeRefus,
  MAX_PAR_SERVEUR,
  MAX_LONGUEUR_NOM,
  MAX_LONGUEUR_REPONSE,
};
