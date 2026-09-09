const fs = require("fs");
const path = require("path");

// Lecture et écriture des fichiers de données du bot.
//
// DEUX DÉFAUTS QUE CE MODULE CORRIGE, et qui se combinaient en une perte
// définitive et silencieuse :
//
//   1. L'écriture n'était pas atomique. `writeFileSync` tronque le fichier
//      AVANT d'écrire : une coupure de courant, un OOM ou un redémarrage à cet
//      instant précis laisse un JSON incomplet sur le disque.
//
//   2. Un JSON illisible était traité comme un fichier VIDE. Chaque magasin
//      fait `try { JSON.parse(...) } catch { cache = {} }` — donc au démarrage
//      suivant, plus aucune permission, plus aucun historique. Et à la
//      première modification, ce vide était réenregistré par-dessus les
//      octets encore présents : les données devenaient irrécupérables.
//
// Le premier point rend la corruption quasi impossible ; le second garantit
// que, si elle survient quand même, les octets d'origine sont CONSERVÉS avant
// toute réécriture.

/**
 * Écrit un JSON de façon atomique.
 *
 * On écrit dans un fichier temporaire, puis on le renomme : `rename` remplace
 * l'ancien fichier d'un seul coup. À aucun instant le fichier de destination
 * n'existe à moitié écrit — il contient soit l'ancienne version complète,
 * soit la nouvelle.
 */
function ecrireJson(chemin, donnees) {
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  // Nom unique : deux processus (ou deux magasins) qui écrivent en même temps
  // ne doivent pas se marcher dessus via un temporaire partagé.
  const temporaire = `${chemin}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    fs.writeFileSync(temporaire, JSON.stringify(donnees, null, 2));
    fs.renameSync(temporaire, chemin);
  } catch (err) {
    // Le temporaire ne doit jamais rester derrière : il s'accumulerait à
    // chaque échec dans le dossier de données.
    try {
      fs.unlinkSync(temporaire);
    } catch {
      // déjà absent
    }
    throw err;
  }
}

/** Met les octets illisibles de côté, pour qu'ils restent récupérables. */
function preserver(chemin, brut) {
  if (!brut) return null;
  const copie = `${chemin}.corrompu-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  try {
    fs.writeFileSync(copie, brut);
    return copie;
  } catch (err) {
    console.error(`[jsonFile] impossible de conserver ${chemin} : ${err.message}`);
    return null;
  }
}

/**
 * Lit un JSON.
 *
 * Se comporte comme `JSON.parse(fs.readFileSync(...))` — y compris en LEVANT
 * sur fichier absent ou illisible, ce qui laisse chaque magasin retomber sur
 * sa valeur par défaut comme avant. La différence est qu'un contenu illisible
 * est d'abord COPIÉ de côté et signalé bruyamment, au lieu de disparaître au
 * premier enregistrement.
 */
function lireJson(chemin) {
  const brut = fs.readFileSync(chemin, "utf8");
  try {
    return JSON.parse(brut);
  } catch (err) {
    const copie = preserver(chemin, brut);
    console.error(
      `[jsonFile] ${chemin} est illisible (${err.message}). ` +
        (copie
          ? `Les données d'origine sont conservées dans ${copie} — le bot repart à vide pour ce fichier.`
          : "Les données d'origine n'ont PAS pu être conservées.")
    );
    throw err;
  }
}

module.exports = { lireJson, ecrireJson, preserver };
