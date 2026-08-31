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
const { buildHelpPanel, groupByTier, identityOf } = require("../utils/helpPanel");
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
// Navigation à trois niveaux désormais (catégorie -> palier -> page) : le
// palier se choisit automatiquement s'il n'y en a qu'un, mais un test qui
// veut un palier PRÉCIS (ex: "documented") doit le demander explicitement.
const bodyOf = (view, tier, page) => buildHelpPanel("g1", member, view, tier, page).components[0].toJSON().components[2].content;

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

  await cas('les commandes muettes vivent dans leur PROPRE palier "documented", jamais mélangées', () => {
    const groups = groupByTier(CATEGORIES.find((c) => c.key === "utilitaire").commands);
    const documentedIds = groups.documented.map((c) => c.name);
    assert.ok(documentedIds.some((n) => n.startsWith("changelogs")), "la référence complète reste accessible");
    const body = bodyOf("utilitaire", "documented");
    assert.ok(body.includes("changelogs"), body);
  });

  await cas("aucune commande n'apparaît à la fois active et non active", () => {
    const groups = groupByTier(CATEGORIES.find((c) => c.key === "utilitaire").commands);
    const documentedNames = groups.documented.map((c) => c.name.split(/\s+/)[0]);
    const activeNames = [...groups.public, ...groups.configurable, ...groups.sys].map((c) => c.name.split(/\s+/)[0]);
    for (const name of ["changelogs", "image", "support"]) {
      assert.ok(!activeNames.includes(name), `${name} ne doit pas figurer parmi les actives`);
      assert.ok(documentedNames.includes(name), `${name} doit figurer parmi les documentées`);
    }
    for (const name of ["calc", "vocinfo", "boosters"]) {
      assert.ok(activeNames.includes(name), `${name} doit figurer parmi les actives`);
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
    assert.ok(body.includes("`pic [@membre]` *(alias : avatar)*"), body);
    assert.ok(body.includes("*(alias : serverinfo)*"));
    assert.ok(body.includes("*(alias : member)*"));
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
    for (const category of CATEGORIES) {
      const groups = groupByTier(category.commands);
      const vus = new Set();
      for (const tier of ["public", "configurable", "sys", "documented"]) {
        for (const cmd of groups[tier]) {
          const id = identityOf(cmd);
          assert.ok(!vus.has(id), `${id} listé deux fois dans la catégorie ${category.key}`);
          vus.add(id);
        }
      }
    }
  });

  console.log("\nSous-commandes distinctes (le bug \"&help incompréhensible\") :");

  await cas("role create/delete/rename/color/admin sont CINQ lignes distinctes, pas fusionnées sous \"role\"", () => {
    // Palier "configurable" explicitement : role/channel n'y sont pas
    // publics, le palier par défaut (le premier non vide) serait "public".
    const groups = groupByTier(CATEGORIES.find((c) => c.key === "server").commands);
    const totalPages = Math.max(1, Math.ceil(groups.configurable.length / 8));
    const body = Array.from({ length: totalPages }, (_, p) => bodyOf("server", "configurable", p)).join("\n");
    for (const sub of ["role create <nom>", "role delete @rôle", "role rename @rôle <nom>", "role color @rôle <hex>", "role admin @rôle"]) {
      assert.ok(body.includes(`\`${sub}\``), `"${sub}" doit apparaître littéralement — trouvé :\n${body}`);
    }
    // Chacune garde sa propre description, preuve qu'aucune n'a été avalée par une autre.
    assert.ok(body.includes("Crée un nouveau rôle"));
    assert.ok(body.includes("Supprime un rôle"));
    assert.ok(body.includes("Renomme un rôle"));
  });

  await cas("channel create/delete/rename/topic sont des lignes distinctes elles aussi", () => {
    const groups = groupByTier(CATEGORIES.find((c) => c.key === "server").commands);
    const totalPages = Math.max(1, Math.ceil(groups.configurable.length / 8));
    const body = Array.from({ length: totalPages }, (_, p) => bodyOf("server", "configurable", p)).join("\n");
    for (const sub of ["channel create <nom> [vocal]", "channel delete [#salon]", "channel rename [#salon] <nom>", "channel topic [#salon] <texte>"]) {
      assert.ok(body.includes(`\`${sub}\``), `"${sub}" doit apparaître littéralement`);
    }
  });

  await cas("une catégorie dense se PAGINE au lieu de tout empiler sur un seul écran", () => {
    // Signalé : même groupées par palier avec description, les listes
    // restaient trop longues à lire (ex: 29 commandes "configurable" dans
    // Gestion du serveur). Vérifie qu'une seule page reste courte, et que
    // le sélecteur de page apparaît bien quand il y a plus d'une page.
    const page0 = bodyOf("server", "configurable", 0);
    assert.ok(page0.length < 1200, `une page ne doit pas dépasser ~8 commandes : ${page0.length} caractères`);
    const panel = buildHelpPanel("g1", member, "server", "configurable", 0);
    const hasPageSelect = panel.components[0].toJSON().components.some(
      (c) => c.type === 1 && c.components[0]?.custom_id?.startsWith("help_page:")
    );
    assert.ok(hasPageSelect, "le sélecteur de page doit apparaître pour une liste de plus de 8 commandes");
  });

  await cas("chaque commande active affiche sa description, pas seulement son nom", () => {
    const body = bodyOf("utilitaire");
    assert.ok(body.includes("`banner [@membre]` — Affiche la bannière d'un membre"));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
