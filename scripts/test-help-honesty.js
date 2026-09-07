/**
 * Vérifie &help (utils/helpPanel.js + utils/implementedCommands.js) :
 *  - accueil compact (juste les catégories THÉMATIQUES et leur effectif :
 *    "Modération — 39 commande(s)"), puis un menu déroulant pour choisir une
 *    catégorie — demande explicite de l'utilisateur : regrouper par thème
 *    (Modération/Sécurité/Rôles & Membres/...) plutôt que par palier de
 *    permission (l'ancien découpage public/configurable/sys, qui mélangeait
 *    des commandes sans rapport dans le même palier "configurable") ;
 *  - une catégorie choisie détaille CHAQUE commande (nom, description,
 *    syntaxe réelle à taper), pas juste une liste de noms nus — réparti sur
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

// Catégories entièrement gardées par une permission (aucune commande réelle
// à permission null dedans) — vérifié directement sur le catalogue, pas
// deviné : un membre sans AUCUN droit ne doit en voir aucune.
const CATEGORIES_GARDEES = ["securite", "roles", "serveur", "support", "communication", "logs", "sauvegardes", "bot"];
// Catégories avec au moins une commande publique — un membre sans droit doit
// voir CELLES-LÀ (et seulement celles-là).
const CATEGORIES_PARTIELLEMENT_PUBLIQUES = ["moderation", "vocal", "informations", "utilitaires"];

/** Concatène TOUS les blocs de texte du panneau (une catégorie dense en a plusieurs). */
function fullText(member = owner, categorie = null) {
  return buildHelpPanel("g1", member, categorie, member.id)
    .components[0].toJSON()
    .components.filter((c) => c.type === 10)
    .map((c) => c.content)
    .join("\n\n");
}
/** Le détail des commandes d'une catégorie, TOUTES PAGES confondues (une catégorie dense est paginée). */
function commandsText(member = owner, categorie) {
  const pieces = [];
  let page = 0;
  for (;;) {
    const json = buildHelpPanel("g1", member, categorie, member.id, page).components[0].toJSON();
    pieces.push(
      ...json.components
        .filter((c) => c.type === 10)
        .slice(1) // titre+légende fusionnés dans un seul bloc désormais
        .map((c) => c.content)
    );
    const pageRow = json.components.find((c) => c.type === 1 && c.components[0].custom_id?.startsWith("help_page:"));
    const hasNext = pageRow?.components[0].options.some((o) => o.label === "Page suivante");
    if (!hasNext) break;
    page++;
  }
  return pieces.join("\n\n");
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

  console.log("\nAccueil (catégories thématiques + effectif, pas de détail) :");

  await cas("l'accueil affiche le nom de chaque catégorie et son effectif, aucun nom de commande", () => {
    const body = fullText();
    assert.ok(/\*\*Modération\*\* — \d+ commande\(s\)/.test(body), body);
    assert.ok(/\*\*Sécurité\*\* — \d+ commande\(s\)/.test(body), body);
    assert.ok(!body.includes("Usage :"), "aucun détail de commande avant d'avoir choisi une catégorie");
  });

  await cas("aucune trace de la section \"documentées\" — plus de commandes muettes affichées du tout", () => {
    assert.ok(!fullText().includes("Documentées"), fullText());
  });

  await cas("regroupé par THÈME — chaque catégorie du catalogue apparaît à l'accueil (fini le tri par palier)", () => {
    const body = fullText();
    for (const cat of CATEGORIES) {
      assert.ok(body.includes(cat.label), `"${cat.label}" doit apparaître à l'accueil`);
    }
  });

  await cas("un membre sans aucun droit ne voit QUE les catégories ayant une commande publique", () => {
    const body = fullText(plain);
    for (const key of CATEGORIES_PARTIELLEMENT_PUBLIQUES) {
      const label = CATEGORIES.find((c) => c.key === key).label;
      assert.ok(body.includes(label), `"${label}" a une commande publique, elle doit apparaître`);
    }
    for (const key of CATEGORIES_GARDEES) {
      const label = CATEGORIES.find((c) => c.key === key).label;
      assert.ok(!body.includes(label), `"${label}" n'a AUCUNE commande publique, elle ne doit pas apparaître`);
    }
  });

  await cas("un membre sans server.members.list/server.info.view ne voit ni les listes de membres ni les fiches d'info", () => {
    const body = commandsText(plain, "informations");
    for (const nom of ["alladmins", "botadmins", "boosters", "rolemembers", "vocinfo", "user", "emoji"]) {
      assert.ok(!body.includes(`**${nom}**`), `"${nom}" ne devrait plus apparaître sans permission dédiée`);
    }
  });

  await cas("&panel n'apparaît (dans \"Bot & Accès\") que pour qui a vraiment accès au panel", () => {
    assert.ok(commandsText(owner, "bot").includes("**panel**"), "le propriétaire a accès au panel, la commande doit apparaître");
    assert.ok(!fullText(plain).includes("panel"), "un membre sans aucun droit ne doit voir &panel dans aucune catégorie");
  });

  console.log("\nUne catégorie choisie : chaque commande en détail (nom, description, syntaxe) :");

  await cas("chaque commande affiche son nom en gras, sa description, et la vraie syntaxe à taper", () => {
    const body = commandsText(owner, "informations");
    assert.ok(body.includes("**banner**"), body);
    assert.ok(body.includes("(Affiche la bannière d'un membre)"), body);
    assert.ok(body.includes("Usage : `&banner [@membre]`"), body);
  });

  await cas("des commandes du même thème atterrissent bien dans la MÊME catégorie (antilink et badwords -> Sécurité)", () => {
    const body = commandsText(owner, "securite");
    assert.ok(body.includes("**antilink"), body);
    assert.ok(body.includes("**badwords"), body);
  });

  await cas("des commandes de thèmes différents n'atterrissent PAS dans la même catégorie (role create -> Rôles, pas Sécurité)", () => {
    assert.ok(!commandsText(owner, "securite").includes("**role create**"));
    assert.ok(commandsText(owner, "roles").includes("**role create**"));
  });

  /** Fabrique une fausse interaction de sélection sur le menu &help, lancée par `clicker` sur la commande de `authorId`. */
  function fakeSelect(values, clicker, authorId) {
    const i = {
      guild: { id: "g1" },
      member: clicker,
      user: { id: clicker.id },
      values,
      customId: `help_tier:${authorId}`,
      replies: [],
      updated: null,
      reply(p) {
        this.replies.push(p);
        return Promise.resolve(p);
      },
      update(p) {
        this.updated = p;
        return Promise.resolve(p);
      },
    };
    return i;
  }

  await cas("changer de catégorie depuis la carte édite le MÊME message en place — jamais de nouveau message", async () => {
    const interaction = fakeSelect(["informations"], owner, owner.id);
    await handleHelpInteraction(interaction);
    assert.strictEqual(interaction.replies.length, 0, "aucun nouveau message ne doit être créé");
    assert.ok(interaction.updated, "le message existant doit être édité en place");
    const body = interaction.updated.components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(body.includes("pic/avatar"), body);
    assert.ok(!body.includes("role create"), "la catégorie Rôles & Membres ne doit plus apparaître");
  });

  await cas("le menu garde toujours une option \"Accueil\" — le chemin retour sans retaper &help", () => {
    const menu = buildHelpPanel("g1", owner, "informations", owner.id)
      .components[0].toJSON()
      .components.find((c) => c.type === 1).components[0];
    const accueil = menu.options.find((o) => o.value === "home");
    assert.ok(accueil, "l'option Accueil doit toujours être présente dans le menu");
    assert.strictEqual(accueil.default, false, "sur une catégorie active, Accueil n'est pas l'option sélectionnée par défaut");
  });

  await cas("choisir \"Accueil\" depuis une catégorie revient bien à la vue compacte", async () => {
    const interaction = fakeSelect(["home"], owner, owner.id);
    await handleHelpInteraction(interaction);
    const body = interaction.updated.components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(/\*\*Modération\*\* — \d+ commande\(s\)/.test(body), body);
    assert.ok(!body.includes("Usage :"), "de retour à l'accueil, plus aucun détail de commande ne doit rester");
  });

  console.log("\nMessage public unique, réservé à qui a lancé &help :");

  await cas("&help est réservé à l'auteur : l'ID du lanceur est encodé dans le customId du menu", () => {
    const menu = buildHelpPanel("g1", owner, null, owner.id)
      .components[0].toJSON()
      .components.find((c) => c.type === 1).components[0];
    assert.strictEqual(menu.custom_id, `help_tier:${owner.id}`);
  });

  await cas("l'auteur qui clique édite le message en place", async () => {
    const interaction = fakeSelect(["bot"], owner, owner.id);
    await handleHelpInteraction(interaction);
    assert.ok(interaction.updated, "le message doit être édité en place pour l'auteur");
    assert.strictEqual(interaction.replies.length, 0);
  });

  await cas("QUELQU'UN D'AUTRE qui clique est refusé — jamais la catégorie d'un autre affichée publiquement à sa place", async () => {
    const intrus = { id: "intrus-1", guild: { id: "g1" }, roles: { cache: new Collection() }, permissions: { has: () => true } };
    const interaction = fakeSelect(["bot"], intrus, owner.id);
    await handleHelpInteraction(interaction);
    assert.strictEqual(interaction.updated, null, "le message public ne doit pas changer pour un clic d'un autre membre");
    assert.strictEqual(interaction.replies.length, 1, "un refus doit être envoyé, seulement à l'intrus");
    assert.ok(interaction.replies[0].flags & MessageFlags.Ephemeral, "le refus doit être privé, pas visible du salon");
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
    const body = commandsText(owner, "informations");
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

  await cas("une identité n'apparaît jamais dans deux catégories à la fois", () => {
    const vus = new Set();
    for (const cat of CATEGORIES) {
      const noms = [...commandsText(owner, cat.key).matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]);
      for (const n of noms) {
        assert.ok(!vus.has(n), `${n} listé dans deux catégories`);
        vus.add(n);
      }
    }
  });

  console.log("\nSous-commandes distinctes (le bug \"&help incompréhensible\") :");

  await cas("role create/delete/rename/color/admin sont CINQ identités distinctes, pas fusionnées sous \"role\"", () => {
    const body = commandsText(owner, "roles");
    for (const sub of ["role create", "role delete", "role rename", "role color", "role admin"]) {
      assert.ok(body.includes(`**${sub}**`), `"${sub}" doit apparaître comme identité distincte`);
    }
  });

  await cas("channel create/delete/rename/topic sont des identités distinctes elles aussi", () => {
    const body = commandsText(owner, "serveur");
    for (const sub of ["channel create", "channel delete", "channel rename", "channel topic"]) {
      assert.ok(body.includes(`**${sub}**`), `"${sub}" doit apparaître comme identité distincte`);
    }
  });

  console.log("\nRépartition sur plusieurs blocs ET plusieurs pages (une catégorie dense ne tient pas dans un seul Container) :");

  /** Chaque bloc de commandes de la catégorie, brut (pas joint), TOUTES PAGES confondues. */
  function allChunks(member, categorie) {
    const chunks = [];
    let page = 0;
    for (;;) {
      const json = buildHelpPanel("g1", member, categorie, member.id, page).components[0].toJSON();
      chunks.push(...json.components.filter((c) => c.type === 10).slice(1));
      const pageRow = json.components.find((c) => c.type === 1 && c.components[0].custom_id?.startsWith("help_page:"));
      const hasNext = pageRow?.components[0].options.some((o) => o.label === "Page suivante");
      if (!hasNext) break;
      page++;
    }
    return chunks;
  }

  await cas("une catégorie dense (\"Sécurité\") est répartie sur PLUSIEURS blocs de texte, chacun sous la limite Discord", () => {
    const parts = allChunks(owner, "securite");
    assert.ok(parts.length > 1, "une seule commande par bloc rendrait ça bien trop long pour un seul bloc de texte");
    for (const p of parts) assert.ok(p.content.length < 4000, `bloc de ${p.content.length} caractères`);
  });

  await cas("chaque page de la catégorie \"Sécurité\" reste sous 4000 caractères affichables AU TOTAL (titre+légende compris)", () => {
    // La vraie cause du plantage prod ("l'application n'a pas répondu") :
    // DiscordAPIError[50035] COMPONENT_DISPLAYABLE_TEXT_SIZE_EXCEEDED — ce
    // n'est PAS une limite par composant (chacun peut déjà aller jusqu'à
    // 4000) mais le total CUMULÉ de tout le texte affichable du message.
    let page = 0;
    let sawMultiplePages = false;
    for (;;) {
      const json = buildHelpPanel("g1", owner, "securite", owner.id, page).components[0].toJSON();
      const totalText = json.components.filter((c) => c.type === 10).reduce((sum, c) => sum + c.content.length, 0);
      assert.ok(totalText < 4000, `page ${page} : ${totalText} caractères affichables au total — Discord refuse au-delà de 4000`);
      const pageRow = json.components.find((c) => c.type === 1 && c.components[0].custom_id?.startsWith("help_page:"));
      const hasNext = pageRow?.components[0].options.some((o) => o.label === "Page suivante");
      if (!hasNext) break;
      sawMultiplePages = true;
      page++;
    }
    assert.ok(sawMultiplePages, "la catégorie dense doit avoir besoin de plusieurs pages pour ce test d'être significatif");
  });

  await cas("la coupe entre deux blocs ne tombe jamais AU MILIEU d'une commande", () => {
    const parts = allChunks(owner, "securite");
    for (const p of parts) {
      assert.ok(p.content.trimStart().startsWith("**"), "chaque bloc doit commencer par le nom d'une commande");
      assert.ok(p.content.includes("Usage : `"), "chaque bloc doit contenir au moins une commande complète");
    }
  });

  await cas("un menu de pagination dédié apparaît sur la catégorie dense, avec \"Page suivante\"", () => {
    const json = buildHelpPanel("g1", owner, "securite", owner.id, 0).components[0].toJSON();
    const pageRow = json.components.find((c) => c.type === 1 && c.components[0].custom_id?.startsWith("help_page:"));
    assert.ok(pageRow, "la catégorie dense doit proposer un menu de pagination");
    assert.strictEqual(pageRow.components[0].custom_id, `help_page:${owner.id}:securite`);
    assert.ok(pageRow.components[0].options.some((o) => o.label === "Page suivante"));
    assert.ok(!pageRow.components[0].options.some((o) => o.label === "Page précédente"), "page 0 : pas de \"page précédente\"");
  });

  await cas("cliquer \"Page suivante\" affiche bien la suite des commandes, sans jamais créer de nouveau message", async () => {
    const page0 = commandsText(owner, "securite").split("\n\n")[0];
    const interaction = {
      guild: { id: "g1" },
      member: owner,
      user: { id: owner.id },
      values: ["1"],
      customId: `help_page:${owner.id}:securite`,
      replies: [],
      updated: null,
      reply(p) {
        this.replies.push(p);
        return Promise.resolve(p);
      },
      update(p) {
        this.updated = p;
        return Promise.resolve(p);
      },
    };
    await handleHelpInteraction(interaction);
    assert.strictEqual(interaction.replies.length, 0, "aucun nouveau message ne doit être créé");
    const body = interaction.updated.components[0].toJSON().components.filter((c) => c.type === 10).slice(1).map((c) => c.content).join("\n\n");
    assert.ok(!body.startsWith(page0), "la page 1 doit montrer d'autres commandes que la page 0");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
