/**
 * Vérifie &help (utils/helpPanel.js + utils/implementedCommands.js) :
 *  - texte pur, groupé par PALIER de droit (Publiques/Configurables/Sys),
 *    chaque commande accessible en une ligne `> \`préfixe+syntaxe\`
 *    (description)`, triée par ordre alphabétique — demande explicite de
 *    remplacer l'accueil-image + navigation par thème par une liste directe
 *    par palier de permission ;
 *  - ne promet jamais de commande muette : seules les entrées avec un VRAI
 *    handler sont affichées, plus de section "documentées" du tout ;
 *  - filtré sur les droits RÉELS de la personne — même moteur que les
 *    commandes et le panel (utils/permissions/engine.js) ;
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
const { buildHelpPages, identityOf } = require("../utils/helpPanel");
const { CATEGORIES } = require("../utils/commandCatalog");
const { getPrefixes } = require("../utils/prefixStore");

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

/** Le texte de TOUTES les pages de &help, concaténé. */
function texteDe(member = owner) {
  return buildHelpPages("g1", member)
    .map((page) => page.components[0].toJSON().components.map((c) => c.content).join("\n"))
    .join("\n\n");
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

  console.log("\n&help — texte pur, groupé par palier de permission :");

  await cas("les trois en-têtes de palier possibles sont bien Publiques/Configurables/Sys", () => {
    // Un palier chargé peut être réparti sur plusieurs blocs ("Configurables
    // (1/3)") — on tolère donc le suffixe de pagination, pas le titre exact.
    const texte = texteDe(owner);
    for (const titre of ["**Publiques", "**Configurables", "**Sys"]) {
      assert.ok(texte.includes(titre), `"${titre}" absent : ${texte.slice(0, 200)}...`);
    }
  });

  await cas("un palier sans commande accessible n'affiche pas son en-tête", () => {
    // `plain` n'a aucun accès configuré : seul Publiques doit apparaître.
    const texte = texteDe(plain);
    assert.ok(texte.includes("**Publiques**"));
    assert.ok(!texte.includes("**Configurables**"), texte);
    assert.ok(!texte.includes("**Sys**"), texte);
  });

  await cas("un membre sans aucun droit ne voit que &help, jamais l'inventaire public", () => {
    const texte = texteDe(plain);
    assert.ok(texte.includes("`&help`"), texte);
    // Aucune autre commande publique (pic/banner/server/snipe...) ne doit
    // apparaître avant qu'un octroi existe.
    assert.ok(!texte.includes("`&pic"), texte);
    assert.ok(!texte.includes("`&server`"), texte);
  });

  await cas("chaque ligne porte la VRAIE syntaxe, sa description, entre parenthèses", () => {
    const texte = texteDe(owner);
    assert.ok(texte.includes("`&banner [@membre]` (Affiche la bannière d'un membre)"), texte);
  });

  await cas("&help ne montre QUE les commandes du préfixe \"&\" — jamais celles de modération/sécurité/vocal", () => {
    // Architecture 4 préfixes (utils/commandRouting.js) : & = gestion,
    // - = modération, !! = sécurité, = = vocal. Chaque aide reste sur SON
    // préfixe — !!help et =help ont déjà chacun leur propre liste figée,
    // &help doit filtrer le catalogue partagé du même principe.
    const texte = texteDe(owner);
    assert.ok(!texte.includes(`\`${getPrefixes("g1").moderation}kick`), "une commande de modération ne doit pas apparaître dans &help");
    assert.ok(!texte.includes("`uo clear`"), "\"uo clear\" (bucket modération, sans préfixe) ne doit pas apparaître dans &help");
    for (const ligne of texte.split("\n").filter((l) => l.startsWith("> `"))) {
      assert.ok(ligne.startsWith(`> \`${getPrefixes("g1").musicMod}`), `ligne hors préfixe "&" : ${ligne}`);
    }
  });

  await cas("une pastille ne promet jamais une commande que le membre ne peut pas lancer", () => {
    const texte = texteDe(plain);
    const canUse = (permission) => require("../utils/permissions/engine").can(plain, permission);
    for (const category of CATEGORIES) {
      for (const cmd of category.commands) {
        if (!isImplemented(cmd) || canUse(cmd.permission)) continue;
        assert.ok(!texte.includes(`\`${cmd.name}\``), `"${cmd.name}" est affichée à un membre qui n'y a pas droit`);
      }
    }
  });

  await cas("aucune trace de la section \"documentées\" — plus de commandes muettes affichées du tout", () => {
    assert.ok(!texteDe().includes("Documentées"), texteDe());
  });

  await cas("un membre sans server.members.list/server.info.view ne voit ni les listes de membres ni les fiches d'info", () => {
    const texte = texteDe(plain);
    for (const nom of ["alladmins", "botadmins", "boosters", "rolemembers", "vocinfo", "user", "emojiinfo"]) {
      assert.ok(!texte.includes(`\`&${nom}`), `"${nom}" ne devrait pas apparaître sans permission dédiée`);
    }
  });

  await cas("&panel n'apparaît que pour qui a vraiment accès au panel", () => {
    assert.ok(texteDe(owner).includes("`&panel`"), "le propriétaire a accès au panel, la commande doit apparaître");
    assert.ok(!texteDe(plain).includes("`&panel`"), "un membre sans aucun droit ne doit voir &panel nulle part");
  });

  await cas("les commandes sont triées par ordre alphabétique dans chaque section", () => {
    const texte = texteDe(owner);
    const section = texte.slice(texte.indexOf("**Configurables"), texte.indexOf("**Sys"));
    // Le préfixe (-, &, !!, =) est retiré avant comparaison : le tri se fait
    // sur l'IDENTITÉ de la commande (utils/helpPanel.js::identityOf), qui
    // n'inclut jamais le symbole de préfixe.
    const noms = [...section.matchAll(/> `([^`]*)`/g)].map((m) => m[1].replace(/^[^a-zA-Z]+/, ""));
    assert.ok(noms.length > 5, "le palier configurable doit contenir plusieurs commandes pour ce test");
    const tries = [...noms].sort((a, b) => a.localeCompare(b));
    assert.deepStrictEqual(noms, tries, "les commandes ne sont pas en ordre alphabétique");
  });

  console.log("\nSous-commandes distinctes (le bug \"&help incompréhensible\") :");

  await cas("role create/delete/rename/color/admin sont CINQ identités distinctes, pas fusionnées sous \"role\"", () => {
    const texte = texteDe(owner);
    for (const sub of ["role create", "role delete", "role rename", "role color", "role admin"]) {
      assert.ok(texte.includes(`&${sub}`), `"${sub}" doit apparaître comme identité distincte`);
    }
  });

  await cas("channel create/delete/rename/topic sont des identités distinctes elles aussi", () => {
    const texte = texteDe(owner);
    for (const sub of ["channel create", "channel delete", "channel rename", "channel topic"]) {
      assert.ok(texte.includes(`&${sub}`), `"${sub}" doit apparaître comme identité distincte`);
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

  await cas("les alias restent visibles, collés au nom de la commande", () => {
    // Les alias sont rappelés dans la description de la commande : sans eux,
    // `&avatar` semblerait ne pas exister.
    const texte = texteDe(owner);
    assert.ok(texte.includes("alias : avatar"), texte);
    assert.ok(texte.includes("alias : serverinfo"), texte);
    assert.ok(texte.includes("alias : member"), texte);
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

  await cas("une identité n'apparaît jamais deux fois dans &help", () => {
    const texte = texteDe(owner);
    const lignes = texte.split("\n").filter((l) => l.startsWith("> `"));
    const syntaxes = lignes.map((l) => l.match(/`([^`]*)`/)[1]);
    assert.strictEqual(new Set(syntaxes).size, syntaxes.length, "une syntaxe est listée deux fois");
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

  console.log("\nPagination (le catalogue complet ne tient pas forcément dans un seul message) :");

  await cas("aucune page ne dépasse le plafond Discord de texte affichable", () => {
    const pages = buildHelpPages("g1", owner);
    for (const page of pages) {
      const total = page.components[0].toJSON().components.map((c) => c.content).join("\n").length;
      assert.ok(total < 4000, `${total} caractères sur une page`);
    }
  });

  await cas("aucune commande ne se perd entre deux pages", () => {
    const pages = buildHelpPages("g1", owner);
    const texte = pages.map((p) => p.components[0].toJSON().components.map((c) => c.content).join("\n")).join("\n");
    const commandRouting = require("../utils/commandRouting");
    const gestion = CATEGORIES.flatMap((c) => c.commands).filter((cmd) => commandRouting.bucketDe(cmd.name) === commandRouting.BUCKET_GESTION);
    const attendues = gestion.filter(isImplemented).map(identityOf);
    for (const id of new Set(attendues)) {
      const cmd = gestion.find((c) => identityOf(c) === id);
      if (!require("../utils/permissions/engine").can(owner, cmd.permission)) continue;
      assert.ok(texte.includes(`${id}\``) || texte.includes(`${id} `), `"${id}" est absente de &help`);
    }
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
