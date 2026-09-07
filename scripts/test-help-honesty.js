/**
 * Vérifie &help (utils/helpPanel.js + utils/implementedCommands.js) :
 *  - accueil épuré (7 catégories thématiques maximum, chacune avec un emoji
 *    et une description courte, JAMAIS de compteur de commandes) puis, une
 *    fois une catégorie choisie, la liste détaillée de ses commandes —
 *    demande explicite de refonte UX : un bot "propre, moderne, agréable à
 *    regarder", 12 catégories ramenées à 7 par fusion thématique (Rôles &
 *    Membres + Salons & Serveur + Vocal -> Serveur & Rôles ; Support +
 *    Communication -> Communauté ; Informations + Logs -> Informations ;
 *    Utilitaires + Sauvegardes -> Outils) ;
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
const { buildHelpPanel, handleHelpInteraction, identityOf } = require("../utils/helpPanel");
const { CATEGORIES } = require("../utils/commandCatalog");
const { can } = require("../utils/permissions/engine");

/**
 * Les identités de commandes que ce membre peut RÉELLEMENT lancer — même
 * règles que utils/helpPanel.js::groupByTier (implémentée + droit accordé).
 * Sert à vérifier qu'aucune pastille de carte ne promet une commande hors de
 * portée. `panel` est écartée : elle est gardée par hasAnyPanelAccess, pas
 * par une clé du catalogue, et a déjà son propre cas de test.
 */
function identitesAccessibles(member) {
  const set = new Set();
  for (const cat of CATEGORIES) {
    for (const cmd of cat.commands) {
      if (!isImplemented(cmd) || identityOf(cmd) === "panel") continue;
      if (!can(member, cmd.permission)) continue;
      set.add(identityOf(cmd));
    }
  }
  return set;
}

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
const CATEGORIES_GARDEES = ["securite", "communaute", "bot"];
// Catégories avec au moins une commande publique — un membre sans droit doit
// voir CELLES-LÀ (et seulement celles-là).
const CATEGORIES_PARTIELLEMENT_PUBLIQUES = ["moderation", "serveurroles", "informations", "outils"];

/**
 * Concatène TOUS les textes du panneau : les blocs simples (type 10) ET ceux
 * nichés dans une carte (type 9 = Section, la carte de catégorie de
 * l'accueil, dont le texte est un enfant et pas un composant de premier
 * niveau).
 */
function textesDe(json) {
  const morceaux = [];
  for (const c of json.components) {
    if (c.type === 10) morceaux.push(c.content);
    else if (c.type === 9) morceaux.push(...c.components.filter((t) => t.type === 10).map((t) => t.content));
  }
  return morceaux;
}
function fullText(member = owner, categorie = null) {
  return textesDe(buildHelpPanel("g1", member, categorie, member.id).components[0].toJSON()).join("\n\n");
}
/** Tous les boutons du panneau, y compris ceux ancrés à droite d'une carte (accessory). */
function tousLesBoutons(json) {
  const boutons = [];
  for (const c of json.components) {
    if (c.type === 1) boutons.push(...c.components);
    else if (c.type === 9 && c.accessory) boutons.push(c.accessory);
  }
  return boutons;
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

  console.log("\nAccueil épuré (emoji + nom + description courte, JAMAIS de compteur) :");

  await cas("l'accueil affiche AU PLUS 7 catégories, chacune avec son emoji et sa description, sans compteur de commandes", () => {
    assert.ok(CATEGORIES.length <= 7, `${CATEGORIES.length} catégories — demande explicite : maximum 7`);
    const body = fullText();
    assert.ok(!/\d+ commande\(s\)/.test(body), `un compteur de commandes traîne encore : ${body}`);
    for (const cat of CATEGORIES) {
      assert.ok(body.includes(cat.emoji), `l'emoji de "${cat.label}" doit apparaître`);
      assert.ok(body.includes(cat.description), `la description de "${cat.label}" doit apparaître`);
    }
    assert.ok(!body.includes("Usage :"), "aucun détail de commande avant d'avoir choisi une catégorie");
  });

  await cas("le préfixe est indiqué clairement, une seule fois, à l'accueil", () => {
    assert.ok(/Préfixe : `&`/.test(fullText()), fullText());
  });

  await cas("l'accueil est une GRILLE DE CARTES : une carte par catégorie, texte à gauche et bouton d'ouverture à droite", () => {
    const json = buildHelpPanel("g1", owner, null, owner.id).components[0].toJSON();
    const cartes = json.components.filter((c) => c.type === 9);
    assert.strictEqual(cartes.length, CATEGORIES.length, "une carte (Section) par catégorie accessible");
    for (const carte of cartes) {
      assert.ok(carte.accessory?.custom_id?.startsWith("help_tier:"), "chaque carte porte son bouton d'ouverture ancré à droite");
      const texte = carte.components.map((t) => t.content).join("\n");
      assert.ok(/^### /.test(texte), `la carte doit s'ouvrir sur un titre fort : ${texte}`);
    }
    assert.ok(!fullText().includes("┈"), "plus de filet décoratif en texte : les blocs sont de vrais composants Separator");
  });

  await cas("chaque carte met en avant de VRAIES commandes du thème, en pastilles (Modération -> kick/ban/mute/warn)", () => {
    const json = buildHelpPanel("g1", owner, null, owner.id).components[0].toJSON();
    const modo = json.components
      .filter((c) => c.type === 9)
      .map((c) => c.components.map((t) => t.content).join("\n"))
      .find((t) => t.includes("MODÉRATION"));
    for (const attendu of ["`kick`", "`ban`", "`mute`", "`warn`"]) {
      assert.ok(modo.includes(attendu), `${attendu} doit être mis en avant sur la carte Modération : ${modo}`);
    }
  });

  await cas("une pastille ne promet jamais une commande que le membre ne peut pas lancer", () => {
    const json = buildHelpPanel("g1", plain, null, plain.id).components[0].toJSON();
    const accessibles = identitesAccessibles(plain);
    for (const carte of json.components.filter((c) => c.type === 9)) {
      const texte = carte.components.map((t) => t.content).join("\n");
      for (const pastille of [...texte.matchAll(/`([^`]+)`/g)].map((m) => m[1])) {
        assert.ok(accessibles.has(pastille), `"${pastille}" est affichée à un membre qui n'y a pas droit`);
      }
    }
  });

  await cas("l'accueil tient sous le plafond Discord de 40 composants (cartes + boutons + filets)", () => {
    const compte = (n) => 1 + (n.components || []).reduce((s, c) => s + compte(c), 0) + (n.accessory ? 1 : 0);
    const total = compte(buildHelpPanel("g1", owner, null, owner.id).components[0].toJSON());
    assert.ok(total <= 40, `${total} composants — Discord refuse au-delà de 40`);
  });

  await cas("aucune trace de la section \"documentées\" — plus de commandes muettes affichées du tout", () => {
    assert.ok(!fullText().includes("Documentées"), fullText());
  });

  await cas("un membre sans aucun droit ne voit QUE les catégories ayant une commande publique", () => {
    // Les cartes affichent le nom en capitales ("MODÉRATION") : on compare
    // donc sur une version normalisée, pas sur la casse du catalogue.
    const body = fullText(plain).toUpperCase();
    for (const key of CATEGORIES_PARTIELLEMENT_PUBLIQUES) {
      const label = CATEGORIES.find((c) => c.key === key).label;
      assert.ok(body.includes(label.toUpperCase()), `"${label}" a une commande publique, elle doit apparaître`);
    }
    for (const key of CATEGORIES_GARDEES) {
      const label = CATEGORIES.find((c) => c.key === key).label;
      assert.ok(!body.includes(label.toUpperCase()), `"${label}" n'a AUCUNE commande publique, elle ne doit pas apparaître`);
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
    assert.ok(body.includes("— Affiche la bannière d'un membre"), body);
    assert.ok(body.includes("`&banner [@membre]`"), body);
  });

  await cas("des commandes du même thème atterrissent bien dans la MÊME catégorie (antilink et badwords -> Sécurité)", () => {
    const body = commandsText(owner, "securite");
    assert.ok(body.includes("**antilink"), body);
    assert.ok(body.includes("**badwords"), body);
  });

  await cas("des commandes de thèmes différents n'atterrissent PAS dans la même catégorie (role create -> Serveur & Rôles, pas Sécurité)", () => {
    assert.ok(!commandsText(owner, "securite").includes("**role create**"));
    assert.ok(commandsText(owner, "serveurroles").includes("**role create**"));
  });

  /** Fabrique un faux clic de bouton de navigation &help (catégorie ou Accueil), lancé par `clicker` sur la commande de `authorId`. */
  function fakeCategoryClick(value, clicker, authorId) {
    const i = {
      guild: { id: "g1" },
      member: clicker,
      user: { id: clicker.id },
      customId: `help_tier:${authorId}:${value}`,
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
    const interaction = fakeCategoryClick("informations", owner, owner.id);
    await handleHelpInteraction(interaction);
    assert.strictEqual(interaction.replies.length, 0, "aucun nouveau message ne doit être créé");
    assert.ok(interaction.updated, "le message existant doit être édité en place");
    const body = interaction.updated.components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(body.includes("pic/avatar"), body);
    assert.ok(!body.includes("role create"), "la catégorie Serveur & Rôles ne doit plus apparaître");
  });

  await cas("le bouton \"Accueil\" est toujours présent dans la navigation — le chemin retour sans retaper &help", () => {
    const json = buildHelpPanel("g1", owner, "informations", owner.id).components[0].toJSON();
    const boutons = json.components.filter((c) => c.type === 1).flatMap((r) => r.components);
    const accueil = boutons.find((b) => b.label === "Accueil");
    assert.ok(accueil, "le bouton Accueil doit toujours être présent");
    assert.strictEqual(accueil.style, 2, "sur une catégorie active, Accueil n'est pas le bouton mis en avant (Secondary, pas Primary)");
  });

  await cas("choisir \"Accueil\" depuis une catégorie revient bien à la grille de cartes", async () => {
    const interaction = fakeCategoryClick("home", owner, owner.id);
    await handleHelpInteraction(interaction);
    const json = interaction.updated.components[0].toJSON();
    const body = textesDe(json).join("\n");
    assert.ok(!/\d+ commande\(s\)/.test(body), body);
    assert.ok(body.includes("MODÉRATION"), body);
    assert.ok(json.components.some((c) => c.type === 9), "l'accueil doit bien être fait de cartes");
    assert.ok(!body.includes("└ `&"), "de retour à l'accueil, plus aucun détail de commande ne doit rester");
  });

  console.log("\nMessage public unique, réservé à qui a lancé &help :");

  await cas("&help est réservé à l'auteur : l'ID du lanceur est encodé dans le customId de CHAQUE bouton de carte", () => {
    const json = buildHelpPanel("g1", owner, null, owner.id).components[0].toJSON();
    const boutons = tousLesBoutons(json);
    assert.ok(boutons.length, "l'accueil doit proposer des boutons d'ouverture");
    for (const b of boutons) {
      assert.ok(b.custom_id.startsWith(`help_tier:${owner.id}:`), `${b.custom_id} n'encode pas l'auteur`);
    }
  });

  await cas("l'auteur qui clique édite le message en place", async () => {
    const interaction = fakeCategoryClick("bot", owner, owner.id);
    await handleHelpInteraction(interaction);
    assert.ok(interaction.updated, "le message doit être édité en place pour l'auteur");
    assert.strictEqual(interaction.replies.length, 0);
  });

  await cas("QUELQU'UN D'AUTRE qui clique est refusé — jamais la catégorie d'un autre affichée publiquement à sa place", async () => {
    const intrus = { id: "intrus-1", guild: { id: "g1" }, roles: { cache: new Collection() }, permissions: { has: () => true } };
    const interaction = fakeCategoryClick("bot", intrus, owner.id);
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
    const body = commandsText(owner, "serveurroles");
    for (const sub of ["role create", "role delete", "role rename", "role color", "role admin"]) {
      assert.ok(body.includes(`**${sub}**`), `"${sub}" doit apparaître comme identité distincte`);
    }
  });

  await cas("channel create/delete/rename/topic sont des identités distinctes elles aussi", () => {
    const body = commandsText(owner, "serveurroles");
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
      assert.ok(p.content.trimStart().startsWith("🔹 **"), "chaque bloc doit commencer par le nom d'une commande");
      assert.ok(p.content.includes("└ `"), "chaque bloc doit contenir au moins une commande complète");
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
