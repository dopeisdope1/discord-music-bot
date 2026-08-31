/**
 * Vérifie &help (utils/helpPanel.js + utils/implementedCommands.js) :
 *  - une seule vue, groupée UNIQUEMENT par palier d'accès (publiques/
 *    configurables/Sys), toutes catégories du catalogue confondues —
 *    demande explicite : le découpage par thème (Modération, Antiraid,
 *    Paramètres de modération...) faisait "40 mille pages" pour rien ;
 *  - ne promet jamais de commande muette : seules les entrées avec un
 *    VRAI handler sont affichées, plus de section "documentées" du tout
 *    (demande explicite : "enlève-moi les trucs documentés qui servent
 *    à rien") ;
 *  - conserve la correction d'identité qui causait le "&help
 *    incompréhensible" d'origine : "role create"/"role delete"/... restent
 *    des entrées distinctes, jamais fusionnées sous "role".
 *
 * Lancement : node scripts/test-help-honesty.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "helphonesty-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection } = require("discord.js");
// Volontairement requis EN PREMIER : ce module fait un require différé de
// musicCommands pour casser la boucle de dépendances. S'il était rompu, la
// première ligne du test planterait.
const { isImplemented } = require("../utils/implementedCommands");
const { buildHelpPanel } = require("../utils/helpPanel");
const { CATEGORIES } = require("../utils/commandCatalog");

let reussis = 0;
async function cas(nom, fn) {
  try {
    await fn();
    reussis++;
    console.log(`  ok — ${nom}`);
  } catch (err) {
    console.error(`  ÉCHEC — ${nom}\n    ${err.stack}`);
    process.exitCode = 1;
  }
}

const owner = { id: "owner-1", guild: { id: "g1" }, roles: { cache: new Collection() }, permissions: { has: () => true } };
const plain = { id: "plain-1", guild: { id: "g1" }, roles: { cache: new Collection() }, permissions: { has: () => false } };
const bodyOf = (member = owner) => buildHelpPanel("g1", member).components[0].toJSON().components[2].content;

/** Toutes les identités listées, tous paliers confondus, à plat. */
function allIdentities(body) {
  return [...body.matchAll(/\*\*[^*]+\(\d+\) :\*\* ([^\n]+)/g)].flatMap((m) => m[1].split(", "));
}

(async () => {
  console.log("Distinction câblé / seulement documenté :");

  await cas("le module se charge seul, sans boucle de dépendances", () => {
    assert.strictEqual(typeof isImplemented, "function");
    assert.strictEqual(isImplemented({ name: "kick <membre>", prefix: "mod" }), true);
  });

  await cas("une commande réellement câblée est reconnue", () => {
    for (const name of ["kick", "ban", "calc <calcul>", "rolemembers <rôle>", "giveaway start <durée> <lot>"]) {
      assert.strictEqual(isImplemented({ name, prefix: "mod" }), true, `${name} devrait être active`);
    }
  });

  await cas("une commande seulement documentée est reconnue comme telle", () => {
    for (const name of ["antitoken <on/off/lock>", "changelogs", "updatebot"]) {
      assert.strictEqual(isImplemented({ name, prefix: "mod" }), false, `${name} ne devrait pas être annoncée active`);
    }
  });

  await cas("une SOUS-COMMANDE non routée n'est pas comptée active", () => {
    for (const name of ["set modlogs", "set boostembed", "clear owners", "clear customs", "server pic", "server list"]) {
      assert.strictEqual(isImplemented({ name, prefix: "mod" }), false, `${name} n'est routée nulle part`);
    }
  });

  await cas("une sous-commande réellement routée reste comptée active", () => {
    for (const name of ["set muterole <rôle>", "clear all sanctions", "role create <nom>", "giveaway start <durée> <lot>", "modlog on [salon]", "ticket settings", "set perm <permission/commande> <rôle/membre>", "clear perms"]) {
      assert.strictEqual(isImplemented({ name, prefix: "mod" }), true, `${name} est bien routée`);
    }
  });

  await cas("un paramètre n'est jamais pris pour une sous-commande", () => {
    for (const name of ["clear <@membre|id> [nombre]", "kick <membre> [raison]", "mute <membre> [raison]"]) {
      assert.strictEqual(isImplemented({ name, prefix: "mod" }), true, name);
    }
  });

  await cas("chaque dispatcher déclaré dans MOD_SUBCOMMANDS existe vraiment", () => {
    const { MOD_COMMAND_NAMES, MOD_SUBCOMMANDS } = require("../utils/musicCommands");
    const handlers = new Set(MOD_COMMAND_NAMES);
    for (const base of Object.keys(MOD_SUBCOMMANDS)) {
      assert.ok(handlers.has(base), `MOD_SUBCOMMANDS déclare "${base}" qui n'a pas de handler`);
    }
  });

  await cas("les déclencheurs sans préfixe ne sont pas comptés comme muets", () => {
    assert.strictEqual(isImplemented({ name: "uo clear" }), true);
  });

  console.log("\nRendu de &help :");

  await cas("aucune trace de la section \"documentées\" — plus de commandes muettes affichées du tout", () => {
    const body = bodyOf();
    assert.ok(!body.includes("Documentées"), body);
    assert.ok(!body.includes("changelogs"), "une commande sans backend ne doit plus apparaître nulle part");
  });

  await cas("groupé uniquement par palier — aucune trace d'un découpage par thème", () => {
    const body = bodyOf();
    for (const theme of ["Modération", "Antiraid", "Gestion du serveur", "Paramètres de modération", "Logs"]) {
      assert.ok(!body.includes(`## ${theme}`) && !body.includes(`— ${theme}`), `"${theme}" ne doit plus apparaître comme titre/rubrique`);
    }
    assert.ok(body.includes("Commandes publiques"));
    assert.ok(body.includes("Commandes configurables"));
  });

  await cas("une seule vue : pas de bouton ni de sélecteur, rien à naviguer", () => {
    const panel = buildHelpPanel("g1", owner);
    assert.strictEqual(panel.components[0].toJSON().components.filter((c) => c.type === 1).length, 0);
  });

  await cas("les commandes de paramètres de modération sont bien rangées avec les autres \"configurables\", pas à part", () => {
    const identites = allIdentities(bodyOf());
    // "antilink" vit dans la catégorie catalogue "Paramètres de modération" ;
    // "role create" vit dans "Gestion du serveur" — les deux doivent
    // atterrir dans le MÊME palier "Commandes configurables", à plat.
    const body = bodyOf();
    const configurableLine = body.split("\n").find((l) => l.startsWith("**Commandes configurables"));
    assert.ok(configurableLine.includes("antilink"), configurableLine);
    assert.ok(configurableLine.includes("role create"), configurableLine);
    assert.ok(identites.includes("antilink") && identites.includes("role create"));
  });

  await cas("un membre sans aucun droit ne voit QUE les commandes publiques", () => {
    const body = bodyOf(plain);
    assert.ok(body.includes("Commandes publiques"));
    assert.ok(!body.includes("Commandes configurables"), body);
    assert.ok(!body.includes("Commandes Sys"), body);
  });

  console.log("\nGarde-fou contre la dérive :");

  await cas("chaque commande annoncée active a bien un handler dans la table", () => {
    const { MOD_COMMAND_NAMES, MOD_SUBCOMMANDS } = require("../utils/musicCommands");
    const handlers = new Set(MOD_COMMAND_NAMES);
    for (const category of CATEGORIES) {
      for (const cmd of category.commands) {
        if (!cmd.prefix || !isImplemented(cmd)) continue;
        const mots = cmd.name.trim().split(/\s+/);
        const base = mots[0].toLowerCase().replace(/[<[|].*$/, "");
        assert.ok(handlers.has(base), `${cmd.name} est annoncée active sans handler`);
        const second = (mots[1] || "").toLowerCase();
        if (second && /^[a-z]+$/.test(second)) {
          assert.ok(MOD_SUBCOMMANDS[base]?.includes(second), `${cmd.name} est annoncée active sans que "${second}" soit routé`);
        }
      }
    }
  });

  console.log("\nAbsence de doublons dans le catalogue :");

  await cas("aucune entrée n'est listée deux fois", () => {
    const seen = new Map();
    for (const c of CATEGORIES) {
      for (const cmd of c.commands) {
        const k = cmd.name.trim().toLowerCase();
        seen.set(k, [...(seen.get(k) || []), c.label]);
      }
    }
    const dups = [...seen].filter(([, cats]) => cats.length > 1);
    assert.deepStrictEqual(dups, [], `entrées en double : ${dups.map(([n, c]) => `"${n}" (${c.join(" + ")})`).join(", ")}`);
  });

  await cas("un alias n'a pas d'entrée séparée, il est replié dans sa commande", () => {
    const noms = new Set(CATEGORIES.flatMap((c) => c.commands).map((cmd) => cmd.name.trim().split(/\s+/)[0].toLowerCase()));
    for (const alias of ["avatar", "serverinfo", "member", "cmute", "tempcmute", "uncmute", "purge", "panic", "unlockall"]) {
      assert.ok(!noms.has(alias), `${alias} est un alias : il ne doit pas occuper sa propre ligne dans &help`);
    }
  });

  await cas("les alias restent visibles, collés à leur commande", () => {
    const body = bodyOf();
    assert.ok(body.includes("pic/avatar"), body);
    assert.ok(body.includes("server/serverinfo"));
    assert.ok(body.includes("userinfo/member"));
  });

  await cas("chaque alias déclaré répond réellement", () => {
    const { MOD_COMMAND_NAMES } = require("../utils/musicCommands");
    const handlers = new Set(MOD_COMMAND_NAMES);
    for (const cmd of CATEGORIES.flatMap((c) => c.commands)) {
      for (const alias of cmd.aliases || []) {
        assert.ok(handlers.has(alias), `${alias} est annoncé comme alias de ${cmd.name} sans handler`);
      }
    }
  });

  await cas("une identité n'apparaît jamais dans deux paliers à la fois", () => {
    const identites = allIdentities(bodyOf());
    const vus = new Set();
    for (const id of identites) {
      assert.ok(!vus.has(id), `${id} listé deux fois`);
      vus.add(id);
    }
  });

  console.log("\nSous-commandes distinctes (le bug \"&help incompréhensible\") :");

  await cas("role create/delete/rename/color/admin sont CINQ identités distinctes, pas fusionnées sous \"role\"", () => {
    const identites = allIdentities(bodyOf());
    for (const sub of ["role create", "role delete", "role rename", "role color", "role admin"]) {
      assert.ok(identites.includes(sub), `"${sub}" doit apparaître comme identité distincte`);
    }
  });

  await cas("channel create/delete/rename/topic sont des identités distinctes elles aussi", () => {
    const identites = allIdentities(bodyOf());
    for (const sub of ["channel create", "channel delete", "channel rename", "channel topic"]) {
      assert.ok(identites.includes(sub), `"${sub}" doit apparaître comme identité distincte`);
    }
  });

  await cas("même pour le propriétaire (vue la plus large possible), tout tient largement sous la limite Discord d'un bloc de texte", () => {
    const body = bodyOf();
    assert.ok(body.length < 4000, `${body.length} caractères`);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
