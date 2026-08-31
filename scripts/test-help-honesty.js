/**
 * Vérifie &help (utils/helpPanel.js + utils/implementedCommands.js) :
 *  - accueil compact (juste les paliers et leur effectif : "Commandes
 *    publiques — 24 commande(s)"), puis un menu déroulant pour choisir un
 *    palier — demande explicite : pas de découpage par thème ("40 mille
 *    pages"), juste public/configurable/Sys ;
 *  - un palier choisi détaille CHAQUE commande (nom, description, syntaxe
 *    réelle à taper), pas juste une liste de noms nus — réparti sur
 *    plusieurs blocs de texte quand ça dépasse la limite Discord d'un seul
 *    bloc (4000 caractères), toujours coupé ENTRE deux commandes ;
 *  - ne promet jamais de commande muette : seules les entrées avec un VRAI
 *    handler sont affichées, plus de section "documentées" du tout ;
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

const { Collection, MessageFlags } = require("discord.js");
// Volontairement requis EN PREMIER : ce module fait un require différé de
// musicCommands pour casser la boucle de dépendances. S'il était rompu, la
// première ligne du test planterait.
const { isImplemented } = require("../utils/implementedCommands");
const { buildHelpPanel, handleHelpInteraction } = require("../utils/helpPanel");
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

/** Concatène TOUS les blocs de texte du panneau (un palier dense en a plusieurs). */
function fullText(member = owner, tier = null) {
  return buildHelpPanel("g1", member, tier)
    .components[0].toJSON()
    .components.filter((c) => c.type === 10)
    .map((c) => c.content)
    .join("\n\n");
}
/** Seuls les blocs de texte APRÈS le titre et la légende (le détail des commandes). */
function commandsText(member = owner, tier) {
  return buildHelpPanel("g1", member, tier)
    .components[0].toJSON()
    .components.filter((c) => c.type === 10)
    .slice(2)
    .map((c) => c.content)
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

  console.log("\nAccueil (paliers + effectif, pas de détail) :");

  await cas("l'accueil affiche juste le nom du palier et son effectif, aucun nom de commande", () => {
    const body = fullText();
    assert.ok(/\*\*Commandes publiques\*\* — \d+ commande\(s\)/.test(body), body);
    assert.ok(/\*\*Commandes configurables\*\* — \d+ commande\(s\)/.test(body), body);
    assert.ok(!body.includes("Usage :"), "aucun détail de commande avant d'avoir choisi un palier");
  });

  await cas("aucune trace de la section \"documentées\" — plus de commandes muettes affichées du tout", () => {
    assert.ok(!fullText().includes("Documentées"), fullText());
  });

  await cas("groupé uniquement par palier — aucune trace d'un découpage par thème", () => {
    const body = fullText();
    for (const theme of ["Modération", "Antiraid", "Gestion du serveur", "Paramètres de modération", "Logs"]) {
      assert.ok(!body.includes(theme), `"${theme}" ne doit plus apparaître`);
    }
  });

  await cas("un membre sans aucun droit ne voit que le palier public à l'accueil", () => {
    const body = fullText(plain);
    assert.ok(body.includes("Commandes publiques"));
    assert.ok(!body.includes("Commandes configurables"), body);
    assert.ok(!body.includes("Commandes Sys"), body);
  });

  console.log("\nUn palier choisi : chaque commande en détail (nom, description, syntaxe) :");

  await cas("chaque commande affiche son nom en gras, sa description, et la vraie syntaxe à taper", () => {
    const body = commandsText(owner, "public");
    assert.ok(body.includes("**banner**"), body);
    assert.ok(body.includes("(Affiche la bannière d'un membre)"), body);
    assert.ok(body.includes("Usage : `&banner [@membre]`"), body);
  });

  await cas("le palier \"configurable\" liste bien ses commandes, tous thèmes confondus", () => {
    const body = commandsText(owner, "configurable");
    // "antilink" vit dans la catégorie catalogue "Paramètres de modération" ;
    // "role create" vit dans "Gestion du serveur" — les deux atterrissent
    // dans le MÊME palier, à plat, sans distinction de thème d'origine.
    assert.ok(body.includes("**antilink"), body);
    assert.ok(body.includes("**role create**"), body);
  });

  await cas("changer de palier depuis la carte affiche bien le détail de CE palier", async () => {
    const interaction = {
      guild: { id: "g1" },
      member: owner,
      values: ["public"],
      message: { flags: { has: () => false } },
      replies: [],
      reply(p) {
        this.replies.push(p);
        return Promise.resolve(p);
      },
    };
    await handleHelpInteraction(interaction);
    const body = interaction.replies[0].components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(body.includes("pic/avatar"), body);
    assert.ok(!body.includes("role create"), "le palier configurable ne doit plus apparaître");
  });

  await cas("le menu garde toujours une option \"Accueil\" — le chemin retour sans retaper &help", () => {
    const menu = buildHelpPanel("g1", owner, "public")
      .components[0].toJSON()
      .components.find((c) => c.type === 1).components[0];
    const accueil = menu.options.find((o) => o.value === "home");
    assert.ok(accueil, "l'option Accueil doit toujours être présente dans le menu");
    assert.strictEqual(accueil.default, false, "sur un palier actif, Accueil n'est pas l'option sélectionnée par défaut");
  });

  await cas("choisir \"Accueil\" depuis un palier revient bien à la vue compacte", async () => {
    const interaction = {
      guild: { id: "g1" },
      member: owner,
      values: ["home"],
      message: { flags: { has: (f) => f === MessageFlags.Ephemeral } },
      reply: () => {
        throw new Error("ne devrait pas être appelé");
      },
      updated: null,
      update(p) {
        this.updated = p;
        return Promise.resolve(p);
      },
    };
    await handleHelpInteraction(interaction);
    const body = interaction.updated.components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(/\*\*Commandes publiques\*\* — \d+ commande\(s\)/.test(body), body);
    assert.ok(!body.includes("Usage :"), "de retour à l'accueil, plus aucun détail de commande ne doit rester");
  });

  console.log("\nÉphémère vs message public (deux personnes, deux droits différents) :");

  await cas("premier clic sur le message PUBLIC -> nouvelle réponse éphémère", async () => {
    const interaction = {
      guild: { id: "g1" },
      member: owner,
      values: ["sys"],
      message: { flags: { has: () => false } },
      replies: [],
      reply(p) {
        this.replies.push(p);
        return Promise.resolve(p);
      },
    };
    await handleHelpInteraction(interaction);
    assert.strictEqual(interaction.replies.length, 1);
    assert.ok(interaction.replies[0].flags & MessageFlags.Ephemeral);
  });

  await cas("clic suivant sur SA carte déjà éphémère -> édition en place, pas d'empilement", async () => {
    let updated = null;
    const interaction = {
      guild: { id: "g1" },
      member: owner,
      values: ["public"],
      message: { flags: { has: (f) => f === MessageFlags.Ephemeral } },
      reply: () => {
        throw new Error("ne devrait pas être appelé");
      },
      update(p) {
        updated = p;
        return Promise.resolve(p);
      },
    };
    await handleHelpInteraction(interaction);
    assert.ok(updated, "aucune édition en place n'a eu lieu");
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

  await cas("les alias restent visibles, collés au nom de la commande", () => {
    const body = commandsText(owner, "public");
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
    const vus = new Set();
    for (const tier of ["public", "configurable", "sys"]) {
      const noms = [...commandsText(owner, tier).matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]);
      for (const n of noms) {
        assert.ok(!vus.has(n), `${n} listé dans deux paliers`);
        vus.add(n);
      }
    }
  });

  console.log("\nSous-commandes distinctes (le bug \"&help incompréhensible\") :");

  await cas("role create/delete/rename/color/admin sont CINQ identités distinctes, pas fusionnées sous \"role\"", () => {
    const body = commandsText(owner, "configurable");
    for (const sub of ["role create", "role delete", "role rename", "role color", "role admin"]) {
      assert.ok(body.includes(`**${sub}**`), `"${sub}" doit apparaître comme identité distincte`);
    }
  });

  await cas("channel create/delete/rename/topic sont des identités distinctes elles aussi", () => {
    const body = commandsText(owner, "configurable");
    for (const sub of ["channel create", "channel delete", "channel rename", "channel topic"]) {
      assert.ok(body.includes(`**${sub}**`), `"${sub}" doit apparaître comme identité distincte`);
    }
  });

  console.log("\nRépartition sur plusieurs blocs (le palier dense ne tient pas dans un seul) :");

  await cas("un palier dense (\"configurable\") est réparti sur PLUSIEURS blocs de texte, chacun sous la limite Discord", () => {
    const parts = buildHelpPanel("g1", owner, "configurable")
      .components[0].toJSON()
      .components.filter((c) => c.type === 10)
      .slice(2); // titre + légende exclus
    assert.ok(parts.length > 1, "une seule commande par bloc rendrait ça bien trop long pour un seul bloc de texte");
    for (const p of parts) assert.ok(p.content.length < 4000, `bloc de ${p.content.length} caractères`);
  });

  await cas("la coupe entre deux blocs ne tombe jamais AU MILIEU d'une commande", () => {
    const parts = buildHelpPanel("g1", owner, "configurable")
      .components[0].toJSON()
      .components.filter((c) => c.type === 10)
      .slice(2);
    for (const p of parts) {
      assert.ok(p.content.trimStart().startsWith("**"), "chaque bloc doit commencer par le nom d'une commande");
      assert.ok(p.content.includes("Usage : `"), "chaque bloc doit contenir au moins une commande complète");
    }
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
