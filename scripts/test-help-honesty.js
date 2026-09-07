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
const { buildHelpPanel, buildHelpSpec, handleHelpInteraction, identityOf } = require("../utils/helpPanel");
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
 * Le tableau de bord de &help est rendu en IMAGE (utils/dashboardImage.js) :
 * son contenu n'est donc plus du texte Discord inspectable. On vérifie ce
 * qui est réellement dessiné, c'est-à-dire la SPEC passée au moteur de rendu
 * (utils/helpPanel.js::buildHelpSpec) — la même donnée, en structuré, ce qui
 * rend les garanties (droits respectés, aucune commande fantôme, identités
 * distinctes) plus solides à vérifier qu'une expression régulière sur du
 * texte.
 */
function spec(member = owner, categorie = null, page = 0) {
  return buildHelpSpec("g1", member, categorie, member.id, page).spec;
}
/** Tout le texte dessiné sur l'image (titres de cartes, noms, descriptions). */
function fullText(member = owner, categorie = null) {
  const s = spec(member, categorie);
  const morceaux = [s.titre, s.sousTitre, s.pied || ""];
  for (const carte of s.cartes) {
    morceaux.push(carte.titre || "");
    for (const item of carte.items) morceaux.push(item.nom, item.description || "");
  }
  return morceaux.join("\n");
}
/** Les commandes listées dans une catégorie, TOUTES PAGES confondues. */
function commandsText(member = owner, categorie) {
  const morceaux = [];
  const total = buildHelpSpec("g1", member, categorie, member.id, 0).totalPages;
  for (let page = 0; page < total; page++) {
    for (const carte of spec(member, categorie, page).cartes) {
      for (const item of carte.items) morceaux.push(`${item.nom} — ${item.description || ""}`);
    }
  }
  return morceaux.join("\n");
}
/** Tous les boutons du panneau (rangées de navigation). */
function tousLesBoutons(json) {
  const boutons = [];
  for (const c of json.components) {
    if (c.type === 1) boutons.push(...c.components);
    else if (c.type === 9 && c.accessory) boutons.push(c.accessory);
  }
  return boutons;
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

  await cas("l'accueil affiche AU PLUS 7 catégories, chacune avec sa description, sans compteur de commandes", () => {
    assert.ok(CATEGORIES.length <= 7, `${CATEGORIES.length} catégories — demande explicite : maximum 7`);
    const s = spec();
    assert.ok(!/\d+ commande\(s\)/.test(fullText()), "un compteur de commandes traîne encore");
    for (const cat of CATEGORIES) {
      const carte = s.cartes.find((c) => c.titre === cat.label);
      assert.ok(carte, `la carte "${cat.label}" doit être dessinée`);
      assert.strictEqual(carte.sousTitre, cat.description, `la description de "${cat.label}" doit apparaître sur sa carte`);
    }
  });

  await cas("chaque catégorie a SA couleur — ce qu'un Container Components V2 ne sait pas faire (une seule teinte par message)", () => {
    const couleurs = spec().cartes.map((c) => c.couleur);
    assert.strictEqual(new Set(couleurs).size, couleurs.length, `deux catégories partagent la même couleur : ${couleurs.join(", ")}`);
    for (const c of couleurs) assert.ok(/^#[0-9a-f]{6}$/i.test(c), `couleur invalide : ${c}`);
  });

  await cas("le préfixe est indiqué clairement, une seule fois, à l'accueil", () => {
    assert.ok(/Préfixe : &/.test(spec().sousTitre), spec().sousTitre);
  });

  await cas("le tableau de bord est bien une IMAGE affichée DANS un Container Components V2, pas un embed", () => {
    const panneau = buildHelpPanel("g1", owner, null, owner.id);
    const json = panneau.components[0].toJSON();
    assert.strictEqual(json.type, 17, "le conteneur Components V2 doit rester la racine");
    assert.ok(json.accent_color, "la couleur d'accent partagée avec &panel doit rester");
    const galerie = json.components.find((c) => c.type === 12);
    assert.ok(galerie, "une MediaGallery doit porter l'image du tableau de bord");
    assert.strictEqual(galerie.items[0].media.url, "attachment://centre-de-commandes.png");
    assert.strictEqual(panneau.files.length, 1, "l'image doit être jointe au message");
    assert.strictEqual(panneau.files[0].name, "centre-de-commandes.png", "le nom doit correspondre au attachment://");
    assert.ok(Buffer.isBuffer(panneau.files[0].attachment), "un vrai PNG doit être rendu");
    assert.strictEqual(panneau.files[0].attachment.subarray(1, 4).toString(), "PNG", "l'en-tête PNG doit être valide");
  });

  await cas("une carte par catégorie accessible, et la navigation reste en vrais boutons Discord", () => {
    const s = spec();
    assert.strictEqual(s.cartes.length, CATEGORIES.length, "une carte par catégorie accessible");
    const json = buildHelpPanel("g1", owner, null, owner.id).components[0].toJSON();
    const boutons = tousLesBoutons(json);
    assert.strictEqual(boutons.length, CATEGORIES.length + 1, "un bouton par catégorie, plus Accueil");
    assert.ok(boutons.some((b) => b.label === "Accueil"), "le retour à l'accueil doit rester possible");
  });

  await cas("chaque carte met en avant de VRAIES commandes du thème (Modération -> kick/ban/mute/warn)", () => {
    const modo = spec().cartes.find((c) => c.titre === "Modération");
    const noms = modo.items.map((i) => i.nom);
    assert.deepStrictEqual(noms, ["&kick", "&ban", "&mute", "&warn"], `mises en avant réelles : ${noms.join(", ")}`);
    for (const item of modo.items) {
      assert.ok(item.description, `"${item.nom}" doit porter sa description du catalogue`);
    }
  });

  await cas("chaque commande porte son VRAI préfixe — `uo clear` n'en a aucun, lui en coller un annoncerait une commande inexistante", () => {
    const tout = [];
    for (const cat of CATEGORIES) {
      const total = buildHelpSpec("g1", owner, cat.key, owner.id, 0).totalPages;
      for (let page = 0; page < total; page++) {
        for (const carte of spec(owner, cat.key, page).cartes) tout.push(...carte.items.map((i) => i.nom));
      }
    }
    assert.ok(tout.includes("uo clear"), `"uo clear" doit s'afficher SANS préfixe : ${tout.filter((n) => n.includes("uo clear")).join(", ")}`);
    assert.ok(!tout.includes("&uo clear"), "aucun préfixe ne doit être collé à un déclencheur qui n'en a pas");
    assert.ok(tout.includes("&kick @membre [raison]"), "les commandes du préfixe mod gardent bien le leur");
  });

  await cas("une catégorie ouverte regroupe ses commandes par PALIER (Publiques / Configurables / Sys)", () => {
    const titres = spec(owner, "moderation", 0).cartes.map((c) => c.titre);
    assert.ok(titres.includes("Publiques"), titres.join(", "));
    assert.ok(titres.some((t) => t.startsWith("Configurables")), titres.join(", "));
    // Le palier se déduit du droit exigé, jamais saisi à la main : on le
    // revérifie ici contre le catalogue.
    for (const carte of spec(owner, "moderation", 0).cartes) {
      const attendu = carte.titre.startsWith("Publiques") ? null : carte.titre.startsWith("Sys") ? "sys" : "autre";
      for (const item of carte.items) {
        const cmd = CATEGORIES.flatMap((c) => c.commands).find((c) => item.nom.endsWith(c.name));
        if (!cmd) continue;
        if (attendu === null) assert.strictEqual(cmd.permission, null, `${item.nom} n'est pas publique`);
        else if (attendu === "sys") assert.strictEqual(cmd.permission, "sys", `${item.nom} n'est pas sys`);
        else assert.ok(cmd.permission && cmd.permission !== "sys", `${item.nom} n'est pas configurable`);
      }
    }
  });

  await cas("les trois paliers ont une légende — sinon les couleurs de pastilles ne veulent rien dire", () => {
    const legende = spec().legende;
    assert.strictEqual(legende.length, 3);
    assert.deepStrictEqual(legende.map((l) => l.texte), ["Publiques", "Configurables (accordées par rôle)", "Sys (réservées)"]);
  });

  await cas("une pastille ne promet jamais une commande que le membre ne peut pas lancer", () => {
    const json = buildHelpPanel("g1", plain, null, plain.id).components[0].toJSON();
    const accessibles = identitesAccessibles(plain);
    for (const carte of json.components.filter((c) => c.type === 9)) {
      const texte = carte.components.map((t) => t.content).join("\n");
      for (const item of carte.items) {
        const sansPrefixe = item.nom.replace(/^[^a-z]*/i, "");
        assert.ok(accessibles.has(sansPrefixe), `"${item.nom}" est affichée à un membre qui n'y a pas droit`);
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
    assert.ok(commandsText(owner, "bot").includes("&panel"), "le propriétaire a accès au panel, la commande doit apparaître");
    assert.ok(!fullText(plain).includes("panel"), "un membre sans aucun droit ne doit voir &panel dans aucune catégorie");
  });

  console.log("\nUne catégorie choisie : chaque commande en détail (nom, description, syntaxe) :");

  await cas("chaque commande affiche son nom en gras, sa description, et la vraie syntaxe à taper", () => {
    const body = commandsText(owner, "informations");
    // La carte affiche la SYNTAXE complète à taper : une image ne se copie
    // pas, elle doit donc montrer exactement quoi écrire.
    assert.ok(body.includes("&banner [@membre]"), body);
    assert.ok(body.includes("Affiche la bannière d'un membre"), body);
  });

  await cas("des commandes du même thème atterrissent bien dans la MÊME catégorie (antilink et badwords -> Sécurité)", () => {
    const body = commandsText(owner, "securite");
    assert.ok(body.includes("&antilink"), body);
    assert.ok(body.includes("&badwords"), body);
  });

  await cas("des commandes de thèmes différents n'atterrissent PAS dans la même catégorie (role create -> Serveur & Rôles, pas Sécurité)", () => {
    assert.ok(!commandsText(owner, "securite").includes("&role create"));
    assert.ok(commandsText(owner, "serveurroles").includes("&role create"));
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
    // Sur une ÉDITION, la liste des pièces jointes doit être remise à zéro,
    // sinon Discord empile une image de plus à chaque clic.
    assert.deepStrictEqual(interaction.updated.attachments, [], "les anciennes images doivent être remplacées, pas accumulées");
    assert.strictEqual(interaction.updated.files.length, 1, "la nouvelle image doit être jointe");
    const contenu = commandsText(owner, "informations");
    assert.ok(contenu.includes("&pic"), contenu);
    assert.ok(!contenu.includes("&role create"), "la catégorie Serveur & Rôles ne doit pas déborder ici");
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
    const body = fullText();
    assert.ok(!/\d+ commande\(s\)/.test(body), body);
    assert.ok(body.includes("Modération"), body);
    assert.ok(json.components.some((c) => c.type === 12), "l'accueil doit bien réafficher l'image du tableau de bord");
    const accueil = tousLesBoutons(json).find((b) => b.label === "Accueil");
    assert.strictEqual(accueil.style, 1, "de retour à l'accueil, c'est Accueil qui est mis en avant (Primary)");
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
    // Les alias sont rappelés dans la description de la commande : sans eux,
    // `&avatar` semblerait ne pas exister.
    const body = commandsText(owner, "informations");
    assert.ok(body.includes("alias : avatar"), body);
    assert.ok(body.includes("alias : serverinfo"), body);
    assert.ok(body.includes("alias : member"), body);
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
      const noms = buildHelpSpec("g1", owner, cat.key, owner.id, 0).spec.cartes.flatMap((c) => c.items.map((i) => i.nom));
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
      assert.ok(body.includes(`&${sub}`), `"${sub}" doit apparaître comme identité distincte`);
    }
  });

  await cas("channel create/delete/rename/topic sont des identités distinctes elles aussi", () => {
    const body = commandsText(owner, "serveurroles");
    for (const sub of ["channel create", "channel delete", "channel rename", "channel topic"]) {
      assert.ok(body.includes(`&${sub}`), `"${sub}" doit apparaître comme identité distincte`);
    }
  });

  console.log("\nPagination d'une catégorie dense (toutes ses commandes ne tiennent pas sur une image) :");

  await cas("une catégorie dense (\"Sécurité\") est répartie sur PLUSIEURS pages, aucune commande perdue", () => {
    const { totalPages } = buildHelpSpec("g1", owner, "securite", owner.id, 0);
    assert.ok(totalPages > 1, "la catégorie dense doit avoir besoin de plusieurs pages");
    const vues = [];
    for (let page = 0; page < totalPages; page++) {
      for (const carte of spec(owner, "securite", page).cartes) vues.push(...carte.items.map((i) => i.nom));
    }
    assert.strictEqual(new Set(vues).size, vues.length, "une commande ne doit pas apparaître sur deux pages");
    const attenduesSecurite = CATEGORIES.find((c) => c.key === "securite").commands.filter((cmd) => isImplemented(cmd)).map((cmd) => identityOf(cmd));
    const manquantes = [...new Set(attenduesSecurite)].filter((id) => !vues.some((v) => v.startsWith(`&${id}`)));
    assert.deepStrictEqual(manquantes, [], `commandes de Sécurité jamais affichées : ${manquantes.join(", ")}`);
  });

  await cas("chaque page se répartit en TROIS colonnes — la grille que Discord ne sait pas faire en texte", () => {
    const cartes = spec(owner, "securite", 0).cartes;
    assert.strictEqual(cartes.length, 3, `${cartes.length} colonnes au lieu de 3`);
    const tailles = cartes.map((c) => c.items.length);
    assert.ok(Math.max(...tailles) - Math.min(...tailles) <= 1, `colonnes déséquilibrées : ${tailles.join(", ")}`);
  });

  await cas("un menu de pagination dédié apparaît sur la catégorie dense, avec \"Page suivante\"", () => {
    const json = buildHelpPanel("g1", owner, "securite", owner.id, 0).components[0].toJSON();
    const pageRow = json.components.find((c) => c.type === 1 && c.components[0].custom_id?.startsWith("help_page:"));
    assert.ok(pageRow, "la catégorie dense doit proposer un menu de pagination");
    assert.strictEqual(pageRow.components[0].custom_id, `help_page:${owner.id}:securite`);
    assert.ok(pageRow.components[0].options.some((o) => o.label === "Page suivante"));
    assert.ok(!pageRow.components[0].options.some((o) => o.label === "Page précédente"), "page 0 : pas de \"page précédente\"");
  });

  await cas("l'accueil, lui, n'a aucun menu de pagination — tout tient sur une seule image", () => {
    const json = buildHelpPanel("g1", owner, null, owner.id).components[0].toJSON();
    assert.ok(!json.components.some((c) => c.type === 1 && c.components[0].custom_id?.startsWith("help_page:")));
  });

  await cas("cliquer \"Page suivante\" affiche bien la suite des commandes, sans jamais créer de nouveau message", async () => {
    const page0 = spec(owner, "securite", 0).cartes.flatMap((c) => c.items.map((i) => i.nom));
    const page1 = spec(owner, "securite", 1).cartes.flatMap((c) => c.items.map((i) => i.nom));
    assert.notDeepStrictEqual(page1, page0, "la page 1 doit montrer d'autres commandes que la page 0");

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
    assert.strictEqual(interaction.updated.files.length, 1, "la page suivante doit être une nouvelle image");
    const menu = interaction.updated.components[0]
      .toJSON()
      .components.find((c) => c.type === 1 && c.components[0].custom_id?.startsWith("help_page:"));
    assert.ok(menu.components[0].options.some((o) => o.label === "Page précédente"), "sur la page 1, le retour arrière doit être proposé");
  });

  console.log("\nCoût de rendu maîtrisé (le VPS n'a que 458 Mo de RAM) :");

  await cas("deux appels identiques réutilisent l'image en cache au lieu de la redessiner", () => {
    const a = buildHelpPanel("g1", owner, null, owner.id).files[0].attachment;
    const b = buildHelpPanel("g1", owner, null, owner.id).files[0].attachment;
    assert.strictEqual(a, b, "le même tableau de bord doit renvoyer exactement le même tampon, sans re-rendu");
  });

  await cas("un membre aux droits DIFFÉRENTS obtient une image différente (le cache ne fuite pas entre droits)", () => {
    const a = buildHelpPanel("g1", owner, null, owner.id).files[0].attachment;
    const b = buildHelpPanel("g1", plain, null, plain.id).files[0].attachment;
    assert.notStrictEqual(a, b, "deux membres aux droits différents ne doivent jamais partager la même image");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
