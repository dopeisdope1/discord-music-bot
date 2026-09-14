/**
 * Une action qui échoue ne doit JAMAIS être annoncée comme réussie.
 *
 * Plusieurs commandes avalaient l'échec de l'action elle-même
 * (`.catch(() => {})`) puis répondaient « fait ». Ce n'est pas un silence,
 * c'est un MENSONGE : la personne croit la sanction appliquée, le rôle
 * retiré, les messages nettoyés — et rien n'a eu lieu, sans la moindre trace
 * dans les logs pour le comprendre après coup.
 *
 * `&unmuteall` était le pire : son compteur s'incrémentait même quand le
 * retrait du rôle échouait, donc il annonçait un nombre de démutes purement
 * inventé.
 *
 * Lancement : node scripts/test-echecs-visibles.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "echecs-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection } = require("discord.js");

let reussis = 0;
function cas(nom, fn) {
  try {
    fn();
    reussis++;
    console.log(`  ok — ${nom}`);
  } catch (err) {
    console.error(`  ÉCHEC — ${nom}\n    ${err.stack}`);
    process.exitCode = 1;
  }
}

/** Le code source d'un module, pour vérifier ce qui n'a pas d'autre point d'observation. */
const source = (relatif) => fs.readFileSync(path.join(__dirname, "..", relatif), "utf8");

console.log("Aucune action de modération n'échoue plus en silence :");

cas("&unmuteall ne compte QUE les démutes réellement appliquées", () => {
  // Le compteur s'incrémentait hors du try : un rôle non retirable comptait
  // quand même pour un démute.
  const code = source("utils/moderationExtra.js");
  const bloc = code.slice(code.indexOf("async function unmuteall"), code.indexOf("async function unmuteall") + 1400);
  assert.ok(/try \{[\s\S]*roles\.remove[\s\S]*count\+\+/.test(bloc), "count++ doit être DANS le try, après le retrait");
  assert.ok(/echecs\.push/.test(bloc), "les échecs doivent être collectés");
  assert.ok(!/roles\.remove\([^)]*\)\.catch\(\(\) => \{\}\)/.test(bloc), "plus de .catch vide sur le retrait");
});

cas("la fin d'un mute temporaire n'est pas ANNONCÉE si le rôle n'a pas pu être retiré", () => {
  // Sinon l'historique enregistre un démute qui n'a jamais eu lieu, et la
  // personne reste muette sans que rien ne l'indique.
  const code = source("utils/moderationExtra.js");
  const i = code.indexOf('"Fin du mute temporaire"');
  const bloc = code.slice(i - 400, i + 400);
  assert.ok(/catch \(err\)[\s\S]*continue;/.test(bloc), "un échec doit interrompre AVANT le rapport");
});

cas("l'anti-nuke journalise un re-bannissement impossible", () => {
  // C'est une DÉFENSE qui n'a pas eu lieu : la personne débannie en rafale
  // reste sur le serveur. Rien nulle part ne permettait de s'en apercevoir.
  const code = source("utils/guard/definitions.js");
  assert.ok(/antiunban[\s\S]{0,600}console\.error/.test(code), "l'échec doit être journalisé");
  assert.ok(!/members\.ban\([^;]*\.catch\(\(\) => \{\}\)/.test(code), "plus de .catch vide sur le bannissement");
});

console.log("\nAucune commande de serveur n'annonce plus un succès imaginaire :");

cas("&untemprole dit la vérité quand le rôle n'a pas pu être retiré", () => {
  const code = source("utils/serverExtra.js");
  const i = code.indexOf("Rôle temporaire retiré par");
  const bloc = code.slice(i - 300, i + 500);
  assert.ok(/catch \(err\)[\s\S]*reply\(message, "error"/.test(bloc), "l'échec doit être dit à la personne");
});

cas("&cleanup annonce les messages RÉELLEMENT supprimés, pas ceux visés", () => {
  // `toDelete.length` était annoncé sans vérifier que bulkDelete avait
  // fonctionné — or il refuse les messages de plus de 14 jours.
  const code = source("utils/serverExtra.js");
  const i = code.indexOf("bulkDelete(toDelete");
  const bloc = code.slice(i - 400, i + 600);
  assert.ok(/\.size/.test(bloc), "le compte doit venir du résultat de bulkDelete");
  assert.ok(!/bulkDelete\(toDelete, true\)\.catch\(\(\) => \{\}\)/.test(bloc), "plus de .catch vide");
  assert.ok(/reply\(message, "error"/.test(bloc), "un refus doit être dit");
});

cas("la fin d'un rôle temporaire n'est pas annoncée si le retrait a échoué", () => {
  const code = source("utils/serverExtra.js");
  const i = code.indexOf('"Fin du rôle temporaire"');
  const bloc = code.slice(i - 400, i + 400);
  assert.ok(/catch \(err\)[\s\S]*continue;/.test(bloc), "un échec doit interrompre AVANT le rapport");
});

console.log("\nLa règle vaut pour tout le code, pas seulement ces six endroits :");

cas("plus aucune action de modération n'est suivie d'un .catch vide", () => {
  // Le filet qui empêche la régression. L'AFFICHAGE, lui, garde le droit
  // d'échouer en silence : inutile de crier parce qu'un embed de confirmation
  // n'est pas parti.
  const dossiers = [path.join(__dirname, "..", "utils")];
  const fautifs = [];
  const ACTIONS = /\b(?:members\.ban|\.kick\(|roles\.(?:add|remove)\(|\.setNickname\(|bulkDelete\()/;
  while (dossiers.length) {
    for (const entree of fs.readdirSync(dossiers.pop(), { withFileTypes: true })) {
      const complet = path.join(entree.path || entree.parentPath, entree.name);
      if (entree.isDirectory()) {
        dossiers.push(complet);
        continue;
      }
      if (!entree.name.endsWith(".js")) continue;
      fs.readFileSync(complet, "utf8")
        .split("\n")
        .forEach((ligne, i) => {
          if (/^\s*(\*|\/\/)/.test(ligne)) return;
          if (ACTIONS.test(ligne) && /\.catch\(\(\) => \{\}\)/.test(ligne)) fautifs.push(`${entree.name}:${i + 1}`);
        });
    }
  }
  assert.deepStrictEqual(fautifs, [], `échecs d'action encore avalés : ${fautifs.join(", ")}`);
});

console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
