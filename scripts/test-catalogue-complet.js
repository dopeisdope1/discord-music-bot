/**
 * Garantit qu'une commande RÉELLEMENT câblée est toujours annonçée par &help.
 *
 * Le contrôle existant (scripts/test-help-honesty.js) vérifie le sens
 * inverse : que le catalogue ne promet pas de commande sans handler. Le sens
 * manquant est tout aussi important — une commande qui fonctionne mais
 * n'apparaît nulle part est, du point de vue de quelqu'un qui utilise le bot,
 * une commande qui n'existe pas.
 *
 * C'est ainsi que `&nick` et `&resetnick` sont restées introuvables : elles
 * marchaient, avec leur permission `members.nick` proprement déclarée, mais
 * aucune entrée de catalogue ne les mentionnait.
 *
 * Lancement : node scripts/test-catalogue-complet.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "catalogue-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { MOD_COMMAND_NAMES, MOD_SUBCOMMANDS } = require("../utils/musicCommands");
const { CATEGORIES } = require("../utils/commandCatalog");
const permCatalog = require("../utils/permissions/catalog");

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

/**
 * Tous les mots-commandes que le catalogue annonce.
 *
 * Une entrée peut regrouper plusieurs commandes derrière une barre verticale
 * (« online|idle|dnd|invisible ») : sans développer ces variantes, un premier
 * jet de ce contrôle avait signalé neuf commandes comme absentes alors
 * qu'elles étaient bel et bien documentées.
 */
function motsDuCatalogue() {
  const mots = new Set();
  for (const categorie of CATEGORIES) {
    for (const cmd of categorie.commands) {
      const premier = cmd.name.trim().split(/\s+/)[0];
      for (const variante of premier.split("|")) mots.add(variante.toLowerCase());
      for (const alias of cmd.aliases || []) mots.add(alias.toLowerCase());
    }
  }
  return mots;
}

console.log("Toute commande câblée est annoncée dans &help :");

cas("aucune commande du dispatcher n'est absente du catalogue", () => {
  const connues = motsDuCatalogue();
  const absentes = MOD_COMMAND_NAMES.filter((nom) => !connues.has(nom.toLowerCase()));
  assert.deepStrictEqual(
    absentes,
    [],
    `ces commandes fonctionnent mais sont introuvables dans &help : ${absentes.join(", ")}`
  );
});

cas("les sous-commandes réellement routées sont annoncées elles aussi", () => {
  // MOD_SUBCOMMANDS liste ce que chaque dispatcher accepte après le premier
  // mot. Une sous-commande routée mais jamais documentée est aussi invisible
  // que la commande d'entrée elle-même.
  //
  // La comparaison se fait sur les MOTS de l'entrée, pas sur son début : une
  // sous-commande est très souvent documentée dans un choix groupé
  // (« antibot <off/on/max> » couvre `antibot on`). Comparer les préfixes
  // signalait à tort une soixantaine de commandes parfaitement documentées.
  const motsParCommande = new Map();
  for (const categorie of CATEGORIES) {
    for (const cmd of categorie.commands) {
      const mots = cmd.name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const commande = mots[0];
      if (!motsParCommande.has(commande)) motsParCommande.set(commande, new Set());
      for (const mot of mots.slice(1)) motsParCommande.get(commande).add(mot);
    }
  }
  const manquantes = [];
  for (const [commande, sous] of Object.entries(MOD_SUBCOMMANDS)) {
    for (const mot of sous) {
      if (!motsParCommande.get(commande)?.has(mot.toLowerCase())) manquantes.push(`${commande} ${mot}`);
    }
  }
  assert.deepStrictEqual(manquantes, [], `sous-commandes routées mais non documentées : ${manquantes.join(", ")}`);
});

console.log("\nLes permissions annoncées existent réellement :");

cas("chaque permission citée par le catalogue est une clé du moteur de permissions", () => {
  // Une clé inventée pour l'affichage ne serait accordable par personne : la
  // commande resterait inaccessible à tout le monde sauf au rang sys.
  const clesReelles = new Set(permCatalog.byCategory().flatMap((g) => g.permissions.map((p) => p.key)));
  const inconnues = new Set();
  for (const categorie of CATEGORIES) {
    for (const cmd of categorie.commands) {
      if (!cmd.permission || cmd.permission === "sys") continue;
      if (!clesReelles.has(cmd.permission)) inconnues.add(`${cmd.name} -> ${cmd.permission}`);
    }
  }
  assert.deepStrictEqual([...inconnues], [], `permissions inexistantes : ${[...inconnues].join(", ")}`);
});

cas("&nick et &resetnick, longtemps introuvables, sont bien annoncées", () => {
  // Cas concret à l'origine de ce fichier : gardé nommément pour que la
  // régression soit lisible si elle revient.
  const connues = motsDuCatalogue();
  for (const nom of ["nick", "resetnick", "help"]) {
    assert.ok(connues.has(nom), `&${nom} est câblée mais absente du catalogue`);
  }
});

console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
