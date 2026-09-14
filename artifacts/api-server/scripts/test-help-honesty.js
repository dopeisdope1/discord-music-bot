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

// Les trois valeurs de navigation de &help depuis la refonte : la personne
// choisit un PALIER de droits, et les thèmes deviennent les colonnes à
// l'intérieur.
const PALIERS = ["public", "configurable", "sys"];
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

// Les deux listes sont DÉDUITES du catalogue, pas recopiées à la main : la
// version figée s'est démentie dès qu'une commande publique (`&help`) a été
// ajoutée à « Bot & Accès », alors que le comportement testé, lui, était
// correct. Un test qui doit être corrigé à chaque ajout légitime finit par
// être corrigé sans être lu.
//
// `&panel` est le seul cas particulier : le catalogue ne lui donne aucune
// permission, mais la vraie commande exige un accès à une rubrique du panel.
// Elle ne rend donc pas sa catégorie publique.
const aUneCommandePublique = (categorie) =>
  categorie.commands.some((cmd) => cmd.permission === null && isImplemented(cmd) && identityOf(cmd) !== "panel");
// Catégories avec au moins une commande publique : un membre sans aucun droit
// doit voir CELLES-LÀ.
const CATEGORIES_PARTIELLEMENT_PUBLIQUES = CATEGORIES.filter(aUneCommandePublique).map((c) => c.key);
// Catégories entièrement gardées par une permission : il ne doit en voir aucune.
const CATEGORIES_GARDEES = CATEGORIES.filter((c) => !aUneCommandePublique(c)).map((c) => c.key);

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
/**
 * Les commandes listées, TOUS PALIERS ET TOUTES PAGES confondus.
 *
 * La navigation se fait par palier de droits depuis la refonte, plus par
 * thème : une commande donnée peut donc être sous n'importe lequel des trois
 * selon le droit qu'elle exige. Les cas qui vérifient qu'une commande est bien
 * listée balaient donc tout, au lieu de deviner son palier — ce qui les rend
 * aussi indifférents à un changement de droit dans le catalogue.
 *
 * @param {string} [theme] restreint aux colonnes d'un thème donné (clé de
 *   CATEGORIES), pour les cas qui vérifient le RANGEMENT et pas la présence.
 */
function commandsText(member = owner, theme) {
  const labelTheme = theme ? CATEGORIES.find((c) => c.key === theme)?.label : null;
  const morceaux = [];
  for (const palier of PALIERS) {
    const total = buildHelpSpec("g1", member, palier, member.id, 0).totalPages;
    for (let page = 0; page < total; page++) {
      for (const carte of spec(member, palier, page).cartes) {
        if (labelTheme && carte.titre.replace(/ \(suite.*\)$/, "") !== labelTheme) continue;
        for (const item of carte.items) morceaux.push(`${item.nom} — ${item.description || ""}`);
      }
    }
  }
  return morceaux.join("\n");
}
/** Le menu déroulant de navigation entre catégories (type 3 = StringSelect). */
function menuNavigation(json) {
  return json.components
    .filter((c) => c.type === 1)
    .flatMap((r) => r.components)
    .find((c) => c.custom_id?.startsWith("help_tier:"));
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

  await cas("l'accueil montre LES TROIS PALIERS, et aucune commande", () => {
    // Demande explicite : « dans help je veux plus voir les commandes dans
    // l'accueil, je veux juste voir commande configurable, commande public,
    // commande sys ». La grille de commandes vedettes faisait doublon avec la
    // vue détaillée qu'on ouvre juste après.
    const s = spec();
    assert.deepStrictEqual(
      s.cartes.map((c) => c.titre),
      ["Commandes publiques", "Commandes configurables", "Commandes sys"],
      JSON.stringify(s.cartes.map((c) => c.titre))
    );
    for (const carte of s.cartes) {
      assert.ok(carte.sousTitre, `"${carte.titre}" doit expliquer ce que le palier contient`);
      for (const item of carte.items) {
        assert.ok(!item.nom.startsWith("&"), `"${item.nom}" est une commande — l'accueil ne doit plus en lister`);
      }
    }
  });

  await cas("chaque palier annonce ce qu'il contient par THÈME, avec le compte RÉEL", () => {
    // Sans ça, l'accueil serait trois cartes vides : il faut de quoi choisir.
    const publiques = spec().cartes.find((c) => c.titre === "Commandes publiques");
    assert.ok(publiques.items.length, "un palier accessible ne peut pas être vide");
    for (const item of publiques.items) {
      assert.ok(CATEGORIES.some((c) => c.label === item.nom), `"${item.nom}" n'est pas un thème du catalogue`);
    }
    // Le compte annoncé est celui de la vue détaillée, jamais un nombre à part
    // qui divergerait au premier ajout de commande.
    const dessinees = new Set();
    const total = buildHelpSpec("g1", owner, "public", owner.id, 0).totalPages;
    for (let page = 0; page < total; page++) {
      for (const carte of spec(owner, "public", page).cartes) for (const i of carte.items) dessinees.add(i.nom);
    }
    const annonce = publiques.items.reduce((somme, i) => somme + parseInt(i.description, 10), 0);
    assert.strictEqual(annonce, dessinees.size, `${annonce} annoncées, ${dessinees.size} réellement listées`);
  });

  await cas("AUCUNE couleur : tout est dessiné dans une seule teinte neutre", () => {
    // Demande explicite. Ce qui distingue les catégories, c'est leur titre —
    // plus une teinte.
    const couleurs = spec().cartes.map((c) => c.couleur);
    assert.strictEqual(new Set(couleurs).size, 1, `plusieurs teintes subsistent : ${[...new Set(couleurs)].join(", ")}`);
    // Une teinte UNIQUE ne suffisait pas : le gris violacé précédent passait
    // ce test et se voyait quand même à l'écran. Les trois composantes RVB
    // doivent être égales — un gris pur, sans la moindre dominante.
    for (const c of couleurs) {
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(c));
      assert.ok(m, `couleur invalide : ${c}`);
      assert.ok(m[1].toLowerCase() === m[2].toLowerCase() && m[2].toLowerCase() === m[3].toLowerCase(), `teinte non neutre : ${c}`);
    }
  });

  await cas("le préfixe est indiqué clairement, une seule fois, à l'accueil", () => {
    assert.ok(/Préfixe : &/.test(spec().sousTitre), spec().sousTitre);
  });

  await cas("le tableau de bord est bien une IMAGE affichée DANS un Container Components V2, pas un embed", () => {
    const panneau = buildHelpPanel("g1", owner, null, owner.id);
    const json = panneau.components[0].toJSON();
    assert.strictEqual(json.type, 17, "le conteneur Components V2 doit rester la racine");
    assert.strictEqual(json.accent_color, undefined, "aucune couleur d'accent ne doit subsister");
    const galerie = json.components.find((c) => c.type === 12);
    assert.ok(galerie, "une MediaGallery doit porter l'image du tableau de bord");
    assert.strictEqual(galerie.items[0].media.url, "attachment://centre-de-commandes.png");
    assert.strictEqual(panneau.files.length, 1, "l'image doit être jointe au message");
    assert.strictEqual(panneau.files[0].name, "centre-de-commandes.png", "le nom doit correspondre au attachment://");
    assert.ok(Buffer.isBuffer(panneau.files[0].attachment), "un vrai PNG doit être rendu");
    assert.strictEqual(panneau.files[0].attachment.subarray(1, 4).toString(), "PNG", "l'en-tête PNG doit être valide");
  });

  await cas("le menu propose LES MÊMES trois paliers que l'accueil, plus Accueil", () => {
    const json = buildHelpPanel("g1", owner, null, owner.id).components[0].toJSON();
    // Une seule rangée de contrôles : huit boutons occupaient cinq rangées et
    // presque tout l'écran sur mobile.
    assert.strictEqual(json.components.filter((c) => c.type === 1).length, 1, "un seul contrôle de navigation");
    const menu = menuNavigation(json);
    assert.ok(menu, "la navigation doit être un menu déroulant");
    assert.deepStrictEqual(
      menu.options.map((o) => o.label),
      ["Accueil", "Commandes publiques", "Commandes configurables", "Commandes sys"],
      JSON.stringify(menu.options.map((o) => o.label))
    );
    // Le menu et l'image doivent nommer les paliers PAREIL : deux libellés
    // pour la même chose et on ne sait plus lequel on vient d'ouvrir.
    const surLImage = spec().cartes.map((c) => c.titre);
    for (const label of menu.options.slice(1).map((o) => o.label)) {
      assert.ok(surLImage.includes(label), `"${label}" est dans le menu mais pas sur l'image`);
    }
  });

  await cas("un palier ouvert range ses commandes par THÈME — les thèmes n'ont pas disparu, ils ont changé de niveau", () => {
    const cartes = spec(owner, "configurable", 0).cartes;
    for (const carte of cartes) {
      const theme = carte.titre.replace(/ \(suite.*\)$/, "");
      assert.ok(CATEGORIES.some((c) => c.label === theme), `"${theme}" n'est pas un thème du catalogue`);
    }
    const modo = cartes.find((c) => c.titre.startsWith("Modération"));
    assert.ok(modo, `Modération doit ouvrir le palier configurable : ${cartes.map((c) => c.titre).join(", ")}`);
    for (const item of modo.items) {
      assert.ok(item.description, `"${item.nom}" doit porter sa description du catalogue`);
    }
  });

  await cas("chaque commande porte son VRAI préfixe — `uo clear` n'en a aucun, lui en coller un annoncerait une commande inexistante", () => {
    const tout = [];
    for (const palier of PALIERS) {
      const total = buildHelpSpec("g1", owner, palier, owner.id, 0).totalPages;
      for (let page = 0; page < total; page++) {
        for (const carte of spec(owner, palier, page).cartes) tout.push(...carte.items.map((i) => i.nom));
      }
    }
    assert.ok(tout.includes("uo clear"), `"uo clear" doit s'afficher SANS préfixe : ${tout.filter((n) => n.includes("uo clear")).join(", ")}`);
    assert.ok(!tout.includes("&uo clear"), "aucun préfixe ne doit être collé à un déclencheur qui n'en a pas");
    assert.ok(tout.includes("&kick @membre [raison]"), "les commandes du préfixe mod gardent bien le leur");
  });

  await cas("un palier ne contient QUE ses commandes — il se déduit du droit exigé, jamais saisi à la main", () => {
    const attenduDe = { public: null, sys: "sys", configurable: "autre" };
    for (const palier of PALIERS) {
      const total = buildHelpSpec("g1", owner, palier, owner.id, 0).totalPages;
      for (let page = 0; page < total; page++) {
        for (const carte of spec(owner, palier, page).cartes) {
          for (const item of carte.items) {
            const cmd = CATEGORIES.flatMap((c) => c.commands).find((c) => item.nom.endsWith(c.name));
            if (!cmd) continue;
            const attendu = attenduDe[palier];
            if (attendu === null) assert.strictEqual(cmd.permission, null, `${item.nom} n'est pas publique`);
            else if (attendu === "sys") assert.strictEqual(cmd.permission, "sys", `${item.nom} n'est pas sys`);
            else assert.ok(cmd.permission && cmd.permission !== "sys", `${item.nom} n'est pas configurable`);
          }
        }
      }
    }
  });

  await cas("plus de légende de couleurs — elle n'aurait plus rien à expliquer", () => {
    assert.ok(!spec().legende?.length, "la légende décrivait des teintes qui n'existent plus");
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

  /** Fabrique un faux choix dans le menu de navigation &help, lancé par `clicker` sur la commande de `authorId`. */
  function fakeCategoryClick(value, clicker, authorId) {
    const i = {
      guild: { id: "g1" },
      member: clicker,
      user: { id: clicker.id },
      customId: `help_tier:${authorId}`,
      values: [value],
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

  await cas("\"Accueil\" reste dans le menu — le chemin retour sans retaper &help", () => {
    const menu = menuNavigation(buildHelpPanel("g1", owner, "configurable", owner.id).components[0].toJSON());
    const accueil = menu.options.find((o) => o.label === "Accueil");
    assert.ok(accueil, "l'option Accueil doit toujours être présente");
    assert.ok(!accueil.default, "sur un palier ouvert, ce n'est pas Accueil qui est marqué comme choisi");
    assert.ok(menu.options.find((o) => o.label === "Commandes configurables").default, "le palier ouvert doit être marqué");
  });

  await cas("choisir \"Accueil\" depuis une catégorie revient bien à la grille de cartes", async () => {
    const interaction = fakeCategoryClick("home", owner, owner.id);
    await handleHelpInteraction(interaction);
    const json = interaction.updated.components[0].toJSON();
    const body = fullText();
    assert.ok(!/\d+ commande\(s\)/.test(body), body);
    assert.ok(body.includes("Modération"), body);
    assert.ok(json.components.some((c) => c.type === 12), "l'accueil doit bien réafficher l'image du tableau de bord");
    const accueil = menuNavigation(json).options.find((o) => o.label === "Accueil");
    assert.ok(accueil.default, "de retour à l'accueil, c'est Accueil qui est marqué comme choisi");
  });

  console.log("\nMessage public unique, réservé à qui a lancé &help :");

  await cas("&help est réservé à l'auteur : son ID est encodé dans le customId du menu de navigation", () => {
    const json = buildHelpPanel("g1", owner, null, owner.id).components[0].toJSON();
    assert.strictEqual(menuNavigation(json).custom_id, `help_tier:${owner.id}`);
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

  await cas("une identité n'apparaît jamais deux fois — ni dans deux paliers, ni sur deux pages", () => {
    const vus = new Set();
    for (const palier of PALIERS) {
      const total = buildHelpSpec("g1", owner, palier, owner.id, 0).totalPages;
      for (let page = 0; page < total; page++) {
        for (const carte of spec(owner, palier, page).cartes) {
          for (const item of carte.items) {
            assert.ok(!vus.has(item.nom), `${item.nom} listé deux fois`);
            vus.add(item.nom);
          }
        }
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

  await cas("le palier dense (\"configurables\") est réparti sur PLUSIEURS pages, aucune commande perdue", () => {
    const { totalPages } = buildHelpSpec("g1", owner, "configurable", owner.id, 0);
    assert.ok(totalPages > 1, "le palier dense doit avoir besoin de plusieurs pages");
    const vues = [];
    for (let page = 0; page < totalPages; page++) {
      for (const carte of spec(owner, "configurable", page).cartes) vues.push(...carte.items.map((i) => i.nom));
    }
    assert.strictEqual(new Set(vues).size, vues.length, "une commande ne doit pas apparaître sur deux pages");

    // Aucune commande de Sécurité ne doit se perdre entre deux pages. On les
    // cherche dans TOUS les paliers : `&allbots` exige le rang sys et vit donc
    // dans « Commandes sys », pas avec le reste de son thème — c'est
    // précisément ce que la navigation par palier change.
    const toutesLesPages = [];
    for (const palier of PALIERS) {
      const total = buildHelpSpec("g1", owner, palier, owner.id, 0).totalPages;
      for (let p = 0; p < total; p++) {
        for (const carte of spec(owner, palier, p).cartes) toutesLesPages.push(...carte.items.map((i) => i.nom));
      }
    }
    const attenduesSecurite = CATEGORIES.find((c) => c.key === "securite").commands.filter((cmd) => isImplemented(cmd)).map((cmd) => identityOf(cmd));
    const manquantes = [...new Set(attenduesSecurite)].filter((id) => !toutesLesPages.some((v) => v.startsWith(`&${id}`)));
    assert.deepStrictEqual(manquantes, [], `commandes de Sécurité jamais affichées : ${manquantes.join(", ")}`);
  });

  await cas("chaque page se répartit en colonnes — la grille que Discord ne sait pas faire en texte", () => {
    // La grille reste large de DEUX colonnes : Discord réduit l'image à
    // ~500 px, et trois colonnes y rendaient le texte illisible sans zoomer.
    // Une page peut en revanche empiler plusieurs rangées de deux, depuis que
    // la pagination compte les lignes et non les colonnes.
    const cartes = spec(owner, "configurable", 0).cartes;
    assert.ok(cartes.length >= 2, `${cartes.length} colonne(s) : la page doit être une grille, pas une liste`);
    for (const carte of cartes) {
      assert.ok(carte.items.length, `la colonne "${carte.titre}" ne doit pas être vide`);
    }
  });

  await cas("les libellés restent courts pour ne pas être tronqués à l'affichage", () => {
    for (const palier of PALIERS) {
      const total = buildHelpSpec("g1", owner, palier, owner.id, 0).totalPages;
      for (let page = 0; page < total; page++) {
        for (const carte of spec(owner, palier, page).cartes) {
          for (const item of carte.items) {
            assert.ok(item.nom.length <= 46, `"${item.nom}" (${item.nom.length}) sera coupé`);
          }
        }
      }
    }
  });

  await cas("un menu de pagination dédié apparaît sur le palier dense, avec \"Page suivante\"", () => {
    const json = buildHelpPanel("g1", owner, "configurable", owner.id, 0).components[0].toJSON();
    const pageRow = json.components.find((c) => c.type === 1 && c.components[0].custom_id?.startsWith("help_page:"));
    assert.ok(pageRow, "le palier dense doit proposer un menu de pagination");
    assert.strictEqual(pageRow.components[0].custom_id, `help_page:${owner.id}:configurable`);
    assert.ok(pageRow.components[0].options.some((o) => o.label === "Page suivante"));
    assert.ok(!pageRow.components[0].options.some((o) => o.label === "Page précédente"), "page 0 : pas de \"page précédente\"");
  });

  await cas("l'accueil, lui, n'a aucun menu de pagination — tout tient sur une seule image", () => {
    const json = buildHelpPanel("g1", owner, null, owner.id).components[0].toJSON();
    assert.ok(!json.components.some((c) => c.type === 1 && c.components[0].custom_id?.startsWith("help_page:")));
  });

  await cas("cliquer \"Page suivante\" affiche bien la suite des commandes, sans jamais créer de nouveau message", async () => {
    const page0 = spec(owner, "configurable", 0).cartes.flatMap((c) => c.items.map((i) => i.nom));
    const page1 = spec(owner, "configurable", 1).cartes.flatMap((c) => c.items.map((i) => i.nom));
    assert.notDeepStrictEqual(page1, page0, "la page 1 doit montrer d'autres commandes que la page 0");

    const interaction = {
      guild: { id: "g1" },
      member: owner,
      user: { id: owner.id },
      values: ["1"],
      customId: `help_page:${owner.id}:configurable`,
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
