/**
 * Vérifie que &help ne promet pas de commandes muettes
 * (utils/implementedCommands.js + utils/helpPanel.js).
 *
 * Le catalogue liste volontairement des commandes SANS backend (demande
 * explicite : "intègre tout, même sans backend"). Les afficher à l'identique
 * des autres revenait à promettre qu'elles répondent : au 31/08, la moitié
 * des entrées listées restaient muettes quand on les tapait. Elles sont donc
 * séparées — et ce test garde la séparation exacte, pour qu'une commande
 * nouvellement câblée quitte automatiquement la liste "pas encore actives".
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

const member = { id: "owner-1", guild: { id: "g1" }, roles: { cache: new Collection() }, permissions: { has: () => true } };
const bodyOf = (view) => buildHelpPanel("g1", member, view).components[0].toJSON().components[2].content;

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
    // "set" et "clear" existent, mais leurs dispatchers ne connaissent pas ces
    // sous-mots : les taper ne fait rien. C'est le faux positif que la table
    // MOD_SUBCOMMANDS supprime.
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
    // "clear <@membre|id> [nombre]" désigne la commande de base, pas un
    // sous-mot "membre" qui n'existerait pas.
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
    // "uo clear" a son propre déclencheur (utils/selfClear.js), pas la table "&".
    assert.strictEqual(isImplemented({ name: "uo clear" }), true);
  });

  console.log("\nRendu de &help :");

  await cas("les commandes muettes sont annoncées comme telles, pas mélangées", () => {
    const body = bodyOf("utilitaire");
    assert.ok(body.includes("pas encore actives"), "une section dédiée doit exister");
    assert.ok(body.includes("changelogs"), "la référence complète reste affichée");
  });

  await cas("aucune commande n'apparaît à la fois active et non active", () => {
    const body = bodyOf("utilitaire");
    const [actives, documentees] = body.split("Documentées, pas encore actives");
    for (const name of ["changelogs", "image", "support"]) {
      assert.ok(!actives.includes(name), `${name} ne doit pas figurer parmi les actives`);
      assert.ok(documentees.includes(name));
    }
    for (const name of ["calc", "vocinfo", "boosters"]) {
      assert.ok(actives.includes(name), `${name} doit figurer parmi les actives`);
    }
  });

  await cas("l'accueil annonce le nombre réel d'actives par catégorie", () => {
    const body = bodyOf();
    assert.ok(/\*\*Utilitaire\*\* — \d+ active\(s\) sur \d+ documentées/.test(body), body);
  });

  await cas("une catégorie entièrement câblée n'affiche aucune mention inutile", () => {
    // La ligne ne doit dire "sur N documentées" QUE s'il reste des muettes.
    const complete = CATEGORIES.find((c) => c.commands.every(isImplemented));
    if (!complete) return; // aucune catégorie complète pour l'instant : rien à vérifier
    assert.ok(!bodyOf().includes(`**${complete.label}** — ${complete.commands.length} active(s) sur`));
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
    const body = bodyOf("utilitaire");
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

  await cas("une commande n'apparaît jamais dans deux paliers à la fois", () => {
    for (const view of CATEGORIES.map((c) => c.key)) {
      const body = bodyOf(view);
      const listes = [...body.matchAll(/\*\*[^*]+\(\d+\) :\*\* ([^\n]+)/g)].map((m) => m[1].split(", "));
      const vus = new Set();
      for (const liste of listes) {
        for (const nom of liste) {
          assert.ok(!vus.has(nom), `${nom} listé deux fois dans la catégorie ${view}`);
          vus.add(nom);
        }
      }
    }
  });

  await cas("une sous-commande ne fait pas réapparaître son dispatcher", () => {
    // "server", "server pic", "server banner" -> un seul "server/serverinfo".
    const body = bodyOf("utilitaire");
    const noms = body.split("**Commandes publiques")[1].split("\n")[0].split(", ");
    assert.strictEqual(noms.filter((n) => n.startsWith("server")).length, 1, noms.join(" | "));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
