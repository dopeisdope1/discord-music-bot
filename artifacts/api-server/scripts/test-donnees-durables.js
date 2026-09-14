/**
 * Durabilité des fichiers de données (utils/jsonFile.js).
 *
 * DEUX DÉFAUTS QUI SE COMBINAIENT EN UNE PERTE DÉFINITIVE :
 *
 *   1. `writeFileSync` tronque le fichier AVANT d'écrire. Une coupure à cet
 *      instant laissait un JSON incomplet sur le disque.
 *   2. Un JSON illisible était traité comme un fichier VIDE — chaque magasin
 *      fait `catch { cache = {} }`. Au démarrage suivant : plus aucune
 *      permission, plus aucun historique. Et à la première modification, ce
 *      vide était réenregistré PAR-DESSUS les octets encore présents.
 *
 * Mesuré avant correction : un `permissions.json` tronqué à la main renvoyait
 * `[]` pour un rôle qui avait des droits, sans le moindre message.
 *
 * Lancement : node scripts/test-donnees-durables.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DOSSIER = fs.mkdtempSync(path.join(os.tmpdir(), "durable-test-"));
process.env.DATA_DIR = DOSSIER;

const { lireJson, ecrireJson, preserver } = require("../utils/jsonFile");

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

const fichier = (nom) => path.join(DOSSIER, nom);

console.log("L'écriture est atomique :");

cas("un aller-retour rend exactement ce qui a été écrit", () => {
  const chemin = fichier("simple.json");
  ecrireJson(chemin, { a: 1, b: ["x"] });
  assert.deepStrictEqual(lireJson(chemin), { a: 1, b: ["x"] });
});

cas("aucun fichier temporaire ne subsiste après écriture", () => {
  // Un temporaire oublié à chaque enregistrement remplirait le disque du VPS.
  const chemin = fichier("temporaire.json");
  for (let i = 0; i < 5; i++) ecrireJson(chemin, { i });
  const restes = fs.readdirSync(DOSSIER).filter((f) => f.includes(".tmp-"));
  assert.deepStrictEqual(restes, [], `temporaires laissés derrière : ${restes.join(", ")}`);
});

cas("le fichier n'est JAMAIS à moitié écrit — l'ancien reste entier jusqu'au bout", () => {
  // C'est la garantie du rename : à aucun instant la destination ne contient
  // un JSON incomplet. On l'observe en interceptant l'écriture du temporaire
  // pour vérifier que la destination porte encore l'ANCIENNE valeur complète.
  const chemin = fichier("atomique.json");
  ecrireJson(chemin, { version: "ancienne" });

  const vraiWrite = fs.writeFileSync;
  let vuePendantEcriture = null;
  fs.writeFileSync = (cible, contenu, ...reste) => {
    const resultat = vraiWrite.call(fs, cible, contenu, ...reste);
    if (String(cible).includes(".tmp-")) vuePendantEcriture = fs.readFileSync(chemin, "utf8");
    return resultat;
  };
  try {
    ecrireJson(chemin, { version: "nouvelle" });
  } finally {
    fs.writeFileSync = vraiWrite;
  }

  assert.deepStrictEqual(JSON.parse(vuePendantEcriture), { version: "ancienne" }, "la destination devait rester intacte pendant l'écriture");
  assert.deepStrictEqual(lireJson(chemin), { version: "nouvelle" });
});

cas("une écriture impossible ne laisse pas de temporaire derrière elle", () => {
  const chemin = fichier("echec.json");
  const vraiRename = fs.renameSync;
  fs.renameSync = () => {
    throw new Error("disque plein");
  };
  try {
    assert.throws(() => ecrireJson(chemin, { a: 1 }), /disque plein/);
  } finally {
    fs.renameSync = vraiRename;
  }
  const restes = fs.readdirSync(DOSSIER).filter((f) => f.startsWith("echec.json.tmp-"));
  assert.deepStrictEqual(restes, []);
});

console.log("\nUn fichier corrompu est CONSERVÉ, pas effacé en silence :");

cas("un JSON tronqué lève — le magasin retombe sur son défaut comme avant", () => {
  const chemin = fichier("tronque.json");
  fs.writeFileSync(chemin, '{"g1":{"role1":["moderation.ban"');
  assert.throws(() => lireJson(chemin), SyntaxError);
});

cas("les octets d'origine sont copiés de côté — c'est ce qui les rend récupérables", () => {
  const chemin = fichier("recuperable.json");
  const contenu = '{"g1":{"role1":["moderation.ban","moderation.kick"]}}INVALIDE';
  fs.writeFileSync(chemin, contenu);
  try {
    lireJson(chemin);
  } catch {
    // attendu
  }
  const copies = fs.readdirSync(DOSSIER).filter((f) => f.startsWith("recuperable.json.corrompu-"));
  assert.strictEqual(copies.length, 1, `attendu une copie, trouvé ${copies.length}`);
  assert.strictEqual(fs.readFileSync(path.join(DOSSIER, copies[0]), "utf8"), contenu, "la copie doit être fidèle à l'octet près");
});

cas("un fichier ABSENT n'est pas traité comme une corruption", () => {
  // Premier démarrage : c'est normal, il ne faut ni copie ni alerte.
  assert.throws(() => lireJson(fichier("jamais-cree.json")), /ENOENT/);
  const copies = fs.readdirSync(DOSSIER).filter((f) => f.startsWith("jamais-cree.json.corrompu-"));
  assert.deepStrictEqual(copies, []);
});

cas("un fichier vide n'engendre pas de copie inutile", () => {
  const chemin = fichier("vide.json");
  fs.writeFileSync(chemin, "");
  assert.strictEqual(preserver(chemin, ""), null, "rien à conserver, donc aucune copie");
});

console.log("\nTous les magasins passent bien par là :");

cas("aucun magasin n'écrit encore en direct", () => {
  // La garantie vaut pour le code écrit plus tard, pas seulement pour les 30
  // fichiers migrés aujourd'hui.
  const dossiers = [path.join(__dirname, "..", "utils")];
  const fautifs = [];
  while (dossiers.length) {
    for (const entree of fs.readdirSync(dossiers.pop(), { withFileTypes: true })) {
      const complet = path.join(entree.path || entree.parentPath, entree.name);
      if (entree.isDirectory()) dossiers.push(complet);
      else if (entree.name.endsWith(".js") && entree.name !== "jsonFile.js") {
        const source = fs.readFileSync(complet, "utf8");
        if (/writeFileSync\([^)]*JSON\.stringify/.test(source)) fautifs.push(entree.name);
        if (/JSON\.parse\(fs\.readFileSync/.test(source)) fautifs.push(entree.name);
      }
    }
  }
  assert.deepStrictEqual([...new Set(fautifs)], [], `à migrer vers jsonFile : ${[...new Set(fautifs)].join(", ")}`);
});

cas("bout en bout : des permissions survivent à une écriture interrompue", () => {
  // Le scénario réel, joué en entier.
  const permissions = fichier("permissions-scenario.json");
  ecrireJson(permissions, { g1: { role1: ["moderation.ban"] } });

  // Coupure pendant l'enregistrement suivant.
  const vraiRename = fs.renameSync;
  fs.renameSync = () => {
    throw new Error("coupure");
  };
  try {
    ecrireJson(permissions, { g1: { role1: ["moderation.ban", "moderation.kick"] } });
  } catch {
    // la coupure
  } finally {
    fs.renameSync = vraiRename;
  }

  // Les droits d'origine sont toujours là, entiers.
  assert.deepStrictEqual(lireJson(permissions), { g1: { role1: ["moderation.ban"] } });
});

console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
