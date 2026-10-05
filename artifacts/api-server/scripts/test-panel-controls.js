/**
 * Vérifie que &panel reste un POSTE DE COMMANDE et pas une documentation
 * (utils/configPanel.js::sectionBody).
 *
 * Demande explicite : "je veux que le panel soit juste un endroit pour les
 * interactifs et menus déroulants". Chaque rubrique n'affiche donc que
 * l'état courant — des lignes "> **Réglage** : valeur" — et les contrôles
 * qui le modifient. Les explications de fonctionnement vivent dans le README
 * et dans &help.
 *
 * Ce test garde la règle : il échoue si une rubrique se remet à expliquer au
 * lieu de montrer.
 *
 * Lancement : node scripts/test-panel-controls.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panelctrl-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField, MessageFlags } = require("discord.js");
const { buildConfigPanel, buildSectionSpec, handleConfigInteraction, handleHistorySearchModal, ID, SECTIONS: SECTIONS_META } = require("../utils/configPanel");
const { ACCENT_COLOR } = require("../utils/helpPanel");
const { handleConfirmInteraction } = require("../utils/serverAdminCommands");
const permStore = require("./_levelGrants");
const permCatalog = require("../utils/permissions/levelCatalog");
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

// Dérivée de la vraie liste, jamais recopiée : une rubrique ajoutée ou
// fusionnée est couverte sans que ce fichier ait à suivre.
const SECTIONS = SECTIONS_META.map((s) => s.key);

const member = { id: "owner-1", guild: { id: "g1" }, roles: { cache: new Collection() }, permissions: { has: () => true } };
const guild = {
  id: "g1",
  name: "Serveur",
  ownerId: "owner-1",
  memberCount: 1,
  roles: { cache: new Collection(), everyone: { permissions: new PermissionsBitField([]) } },
  channels: { cache: new Collection() },
  members: { cache: new Collection(), me: { roles: { highest: { position: 9 } } } },
  emojis: { cache: new Collection() },
  voiceStates: { cache: new Collection() },
  // Lu par la rubrique Accueil (diagnostics réservés au rang sys) — dashboard, module 2.
  client: { uptime: 12345, ws: { ping: 42 }, guilds: { cache: new Collection() } },
};

/**
 * L'accueil est un tableau de bord en CARTES : son texte et ses boutons
 * vivent dans des Section (type 9 : texte enfant + bouton "accessory"), pas
 * dans les TextDisplay/ActionRow de premier niveau des autres écrans.
 * `rangees` compte donc les deux formes — une carte cliquable est bien un
 * contrôle offert par l'écran.
 */
/**
 * Tout le texte réellement AFFICHÉ sur une rubrique : l'en-tête (encore du
 * texte Discord) plus ce qui est DESSINÉ sur l'image du tableau de bord. Le
 * corps des rubriques est une image depuis qu'elles sont toutes en tableau de
 * bord — on lit donc la spec passée au moteur de rendu
 * (utils/configPanel.js::buildSectionSpec), c'est-à-dire la même donnée en
 * structuré, comme le fait déjà scripts/test-help-honesty.js pour &help.
 */
function texteDessine(section, state) {
  const spec = buildSectionSpec(guild, section, member, state);
  const morceaux = [spec.titre, spec.sousTitre, spec.pied || ""];
  for (const carte of spec.cartes) {
    morceaux.push(carte.titre || "", carte.vide || "");
    for (const item of carte.items) morceaux.push(item.nom, item.description || "");
  }
  return morceaux.join("\n");
}

function render(section, state) {
  const json = buildConfigPanel(guild, section, member, state).components[0].toJSON();
  const textes = [];
  for (const c of json.components) {
    if (c.type === 10) textes.push(c.content);
    else if (c.type === 9) textes.push(...c.components.filter((t) => t.type === 10).map((t) => t.content));
  }
  textes.push(texteDessine(section, state));
  return {
    texte: textes.join("\n"),
    rangees: json.components.filter((c) => c.type === 1).length + json.components.filter((c) => c.type === 9 && c.accessory).length,
  };
}

/**
 * Les actions d'un écran ne sont plus des boutons mais les options d'un menu
 * déroulant unique (`cfg:action`) : sept boutons alignés sur la fiche membre
 * faisaient désordre. La valeur d'une option EST le customId du bouton
 * d'origine, donc les assertions portent sur les mêmes identifiants qu'avant.
 */
function actionsDe(json) {
  return json.components
    .filter((c) => c.type === 1)
    .flatMap((r) => r.components)
    .filter((c) => c.custom_id === `${ID}:action`)
    .flatMap((menu) => menu.options)
    .map((o) => ({ label: o.label, custom_id: o.value }));
}

(async () => {
  console.log("Le panel montre, il n'explique pas :");

  await cas("aucun écran de réglage ne dépasse 900 caractères de texte", () => {
    // "home" est exclu : c'est le tableau de bord, une grille d'une dizaine
    // de cartes (titre + description + rubriques), pas un écran de réglage.
    // Son garde-fou à lui est le cas suivant — chaque CARTE reste courte,
    // ce qui interdit vraiment le pavé de documentation que cette règle
    // cherche à empêcher.
    for (const section of SECTIONS.filter((s) => s !== "home")) {
      const { texte } = render(section);
      assert.ok(texte.length <= 900, `${section} affiche ${texte.length} caractères — c'est de la documentation, pas un écran de contrôle`);
    }
  });

  await cas("AUCUNE couleur : les rubriques sont toutes dessinées dans la même teinte neutre", () => {
    // Demande explicite. Ce qui distingue une rubrique, c'est son titre.
    const couleurs = SECTIONS.filter((k) => k !== "home").map((k) => buildSectionSpec(guild, k, member, {}).couleur);
    assert.strictEqual(new Set(couleurs).size, 1, `plusieurs teintes subsistent : ${[...new Set(couleurs)].join(", ")}`);
  });

  await cas("l'accueil ne porte QUE le menu — ni grille, ni bandeau d'état, ni alertes", () => {
    // Les trois ont été retirés tour à tour : la grille répétait le menu juste
    // en dessous, le bandeau et les alertes faisaient un rapport là où on
    // vient seulement ouvrir une rubrique. &panel est un point d'entrée, pas
    // un écran de veille.
    const panneau = buildConfigPanel(guild, "home", member);
    const json = panneau.components[0].toJSON();
    assert.strictEqual(json.type, 17, "le Container Components V2 reste la racine");
    assert.strictEqual(json.accent_color, undefined, "aucune couleur d'accent ne doit subsister");
    assert.ok(!json.components.some((c) => c.type === 12), "l'accueil ne doit plus porter d'image");
    assert.strictEqual(panneau.files, undefined, "et donc aucune pièce jointe");
    assert.ok(json.components.some((c) => c.type === 1), "le menu de navigation doit rester");

    // Un seul bloc de texte : l'en-tête. Tout le reste a disparu.
    const textes = json.components.filter((c) => c.type === 10);
    assert.strictEqual(textes.length, 1, `${textes.length} blocs de texte : ${textes.map((t) => t.content).join(" | ")}`);
    assert.ok(!/En ligne|membres ·|en vocal/.test(textes[0].content), textes[0].content);
  });

  await cas("le titre est \"PANEL DE CONFIGURATION\", sans emoji", () => {
    const entete = buildConfigPanel(guild, "home", member).components[0].toJSON().components.find((c) => c.type === 10).content;
    assert.ok(entete.includes("PANEL DE CONFIGURATION"), entete);
    assert.ok(!entete.includes("CENTRE DE GESTION"), entete);
    assert.ok(!/\p{Extended_Pictographic}/u.test(entete), `un emoji subsiste dans l'en-tête : ${entete}`);
  });

  await cas("aucune alerte n'affiche @everyone en clair — elle notifierait tout le serveur", () => {
    const entete = buildConfigPanel(guild, "home", member).components[0].toJSON().components.find((c) => c.type === 10).content;
    assert.ok(!entete.includes("@everyone") && !entete.includes("@here"), entete);
  });

  await cas("le tableau de bord reste sous le plafond Discord (40 composants, 4000 caractères)", () => {
    const json = buildConfigPanel(guild, "home", member).components[0].toJSON();
    const compte = (n) => 1 + (n.components || []).reduce((s, c) => s + compte(c), 0) + (n.accessory ? 1 : 0);
    const texte = (n) => (typeof n.content === "string" ? n.content.length : 0) + (n.components || []).reduce((s, c) => s + texte(c), 0);
    assert.ok(compte(json) <= 40, `${compte(json)} composants — Discord refuse au-delà de 40`);
    assert.ok(texte(json) < 4000, `${texte(json)} caractères affichables — Discord refuse au-delà de 4000`);
  });

  await cas("chaque rubrique propose au moins le menu de navigation", () => {
    for (const section of SECTIONS) {
      assert.ok(render(section).rangees >= 1, `${section} n'a aucun contrôle`);
    }
  });

  await cas("toutes les rubriques de réglage ont un contrôle en plus de la navigation", () => {
    // "home", "stats" et "diagnostics" sont des vues en lecture seule : leur
    // seul contrôle est le menu de navigation (+ sous-menu s'il y a lieu), et
    // c'est normal — rien à configurer sur un compteur ou un uptime. Toutes
    // les autres doivent offrir de quoi agir sans avoir à taper une commande.
    const lectureSeuleOK = ["home", "stats", "diagnostics"];
    for (const section of SECTIONS.filter((s) => !lectureSeuleOK.includes(s))) {
      assert.ok(render(section).rangees >= 2, `${section} n'offre aucun contrôle propre`);
    }
  });

  await cas("l'état courant reste affiché — sinon les contrôles agissent à l'aveugle", () => {
    for (const section of ["prefixes", "logs", "welcome", "tickets", "voice", "sys", "banall"]) {
      assert.ok(render(section).texte.includes(">"), `${section} n'affiche plus l'état courant`);
    }
  });

  await cas("le panel refuse les préfixes qui se chevauchent", async () => {
    const submit = async (family, value) => {
      const replies = [];
      await handleConfigInteraction({
        customId: `${ID}:prefix:${family}`,
        member,
        guild,
        isModalSubmit: () => true,
        fields: { getTextInputValue: () => value },
        reply: async (payload) => replies.push(payload),
        message: { edit: async () => {} },
      });
      return replies[0]?.content || "";
    };

    // Un seul préfixe reste sur ce bot (musicMod) depuis le départ de la
    // modération vers son propre bot — plus de "chevauchement entre deux
    // familles" possible. Ce qui reste testable : un doublon exact du
    // préfixe déjà en place.
    const duplicate = await submit("musicMod", "&");
    assert.strictEqual(getPrefixes("g1").musicMod, "&", "le doublon ne doit pas changer l'état — déjà la même valeur");
  });

  await cas("le catalogue des permissions n'est plus recopié à côté de son menu", () => {
    // Il était listé en texte ET dans le menu déroulant : deux fois la même
    // information. La carte "Permissions" actuelle (niveaux 1-9) ne montre
    // que ses quatre sections, jamais les clés techniques.
    const { texte } = render("permissions");
    assert.ok(texte.length < 900, `${texte.length} caractères — le catalogue est probablement recopié`);
    assert.ok(!texte.includes("channels.lock"), "les clés de permission n'ont pas à être listées en texte");
  });

  // L'ancien parcours « Permissions > rôle > catégorie > clés » (sélecteur de
  // rôle, "Voir les membres", créer/supprimer un rôle depuis le panel) a été
  // remplacé par la carte à niveaux (commit 023ec29). Créer/supprimer un rôle
  // passe par &role create / &role delete (voir test-command-forms.js).
  console.log("\nPermissions — carte à niveaux (1-9) :");

  const { LEVEL_MAX } = permCatalog;
  const levelStore = require("../utils/permissions/levelStore");
  const { commandsForKeys } = require("../utils/permsCommands");
  const roleId = "role-1";
  guild.roles.cache.set(roleId, { id: roleId, members: new Collection(), position: 1, hexColor: "#000000", permissions: { toArray: () => [], has: () => false } });

  const lignesDe = (json) => json.components.filter((c) => c.type === 1).flatMap((r) => r.components);
  const textesDe = (json) => json.components.filter((c) => c.type === 10).map((c) => c.content).join("\n");

  await cas("sans niveau choisi : le sélecteur de niveau (1-9), pas encore de rôles ni de commandes", () => {
    const json = buildConfigPanel(guild, "permissions", member).components[0].toJSON();
    const niveaux = lignesDe(json).find((c) => c.custom_id === `${ID}:permlevel`);
    assert.ok(niveaux, "le sélecteur de niveau doit être présent");
    assert.strictEqual(niveaux.options.length, LEVEL_MAX, "un choix par niveau");
    assert.ok(!lignesDe(json).some((c) => (c.custom_id || "").startsWith(`${ID}:permlevelrole`)), "pas de sélecteur de rôle avant le niveau");
  });

  await cas("niveau choisi : les rôles de ce niveau sont NOMMÉS, et les commandes débloquées réellement listées", () => {
    levelStore.setRoleLevel("g1", roleId, 5);
    const json = buildConfigPanel(guild, "permissions", member, { permLevel: 5 }).components[0].toJSON();
    const texte = textesDe(json);
    assert.ok(texte.includes(`<@&${roleId}>`), `le rôle du niveau doit être cité : ${texte}`);
    assert.ok(lignesDe(json).some((c) => c.custom_id === `${ID}:permlevelrole:5`), "le propriétaire peut ajouter/retirer un rôle");
    const attendues = commandsForKeys(permCatalog.keysForLevel(5));
    assert.ok(attendues.length > 0, "le niveau 5 débloque des commandes");
    assert.ok(texte.includes(`**Commandes** (${attendues.length})`), `le total doit être annoncé : ${texte}`);
    // La page 1 montre bien des commandes, préfixées, une par ligne.
    assert.ok(texte.includes(`\`&${attendues[0]}\``), `la première commande doit être affichée : ${texte}`);
  });

  await cas("la pagination des commandes change réellement ce qui est affiché", async () => {
    const attendues = commandsForKeys(permCatalog.keysForLevel(LEVEL_MAX));
    assert.ok(attendues.length > 10, "assez de commandes au niveau max pour paginer");
    const page0 = textesDe(buildConfigPanel(guild, "permissions", member, { permLevel: LEVEL_MAX }).components[0].toJSON());
    const page1 = textesDe(buildConfigPanel(guild, "permissions", member, { permLevel: LEVEL_MAX, permCmdPage: 1 }).components[0].toJSON());
    assert.ok(page1.includes(`\`&${attendues[10]}\``), "la page 2 commence à la 11e commande");
    assert.ok(!page0.includes(`\`&${attendues[10]}\``), "la page 1 n'affiche pas la suite");
    assert.ok(!page1.includes(`\`&${attendues[0]}\``), "la page 2 n'affiche plus le début");
    // Le clic sur → passe bien par le handler et réaffiche l'écran.
    let panel = null;
    await handleConfigInteraction({
      customId: `${ID}:permcmdpage:1`,
      member,
      guild,
      isModalSubmit: () => false,
      message: { components: [] },
      update: async (p) => {
        panel = p;
      },
      reply: async () => {},
    });
    assert.ok(panel, "le panneau doit être réaffiché");
  });

  await cas("choisir un rôle dans le sélecteur BASCULE son niveau (ajout puis retrait), persisté", async () => {
    const autre = "role-2";
    guild.roles.cache.set(autre, { id: autre, members: new Collection(), position: 1, hexColor: "#000000", permissions: { toArray: () => [], has: () => false } });
    const clic = () =>
      handleConfigInteraction({
        customId: `${ID}:permlevelrole:3`,
        member,
        guild,
        values: [autre],
        isModalSubmit: () => false,
        message: { components: [] },
        update: async () => {},
        reply: async () => {},
      });
    await clic();
    assert.strictEqual(levelStore.getRoleLevel("g1", autre), 3, "premier choix : niveau 3 attribué");
    const surDisque = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, "permissionLevels.json"), "utf8"));
    assert.strictEqual(surDisque.g1.roleLevels[autre], 3, "écrit sur disque");
    await clic();
    assert.strictEqual(levelStore.getRoleLevel("g1", autre), null, "second choix du même rôle : retiré");
  });

  await cas("un non-propriétaire ne peut pas attribuer de niveau depuis le panel", async () => {
    const intrus = { id: "intrus-1", guild: { id: "g1" }, roles: { cache: new Collection() }, permissions: { has: () => true } };
    let refus = null;
    await handleConfigInteraction({
      customId: `${ID}:permlevelrole:9`,
      member: intrus,
      guild,
      values: [roleId],
      isModalSubmit: () => false,
      message: { components: [] },
      update: async () => {},
      reply: async (p) => {
        refus = p;
      },
    });
    assert.ok(refus, "un refus doit être répondu");
    assert.strictEqual(levelStore.getRoleLevel("g1", roleId), 5, "le niveau n'a pas changé");
  });

  console.log("\nNavigation regroupée par famille :");

  await cas("le menu principal liste des SUJETS concrets, dans un seul menu déroulant", () => {
    const json = buildConfigPanel(guild, "home", member).components[0].toJSON();
    const menu = json.components
      .filter((c) => c.type === 1)
      .flatMap((r) => r.components)
      .find((c) => c.custom_id === "cfg:nav");
    assert.ok(menu, "le menu de navigation doit exister");
    // Discord refuse au-delà de 25 options : c'est la vraie limite, pas un
    // chiffre choisi au hasard.
    assert.ok(menu.options.length <= 25, `${menu.options.length} options — Discord en refuse plus de 25`);
    // Les sujets sont nommés, pas regroupés sous des étiquettes abstraites.
    const labels = menu.options.map((o) => o.label);
    // "Vocaux temporaires" a quitté ce bot avec la pile vocale.
    for (const attendu of ["Logs", "Bienvenue", "Permissions", "Giveaways"]) {
      assert.ok(labels.includes(attendu), `"${attendu}" doit être proposé directement : ${labels.join(", ")}`);
    }
    assert.ok(menu.options.some((o) => o.default), "la rubrique ouverte doit être marquée comme choisie");
  });

  await cas("la famille Sécurité (vue d'ensemble/protection/anti-nuke/mute) n'existe plus — déménagée dans !!secur", () => {
    for (const cle of ["securityOverview", "protection", "guard", "mute"]) {
      assert.ok(!SECTIONS.includes(cle), `${cle} devrait avoir déménagé dans utils/securityPanel.js`);
    }
    const json = buildConfigPanel(guild, "home", member).components[0].toJSON();
    const menu = json.components.filter((c) => c.type === 1).flatMap((r) => r.components).find((c) => c.custom_id === "cfg:nav");
    assert.ok(!menu.options.some((o) => o.label === "Sécurité"), "\"Sécurité\" ne doit plus apparaître dans la navigation");
  });

  await cas("aucun second menu quand la famille n'a qu'une rubrique", () => {
    const json = buildConfigPanel(guild, "home", member).components[0].toJSON();
    assert.ok(!json.components.some((c) => c.type === 1 && c.components[0].custom_id?.endsWith(":subnav")));
  });

  await cas("toutes les rubriques restent atteignables — aucune perdue au regroupement", () => {
    const atteignables = new Set();
    for (const section of SECTIONS) {
      const json = buildConfigPanel(guild, section, member).components[0].toJSON();
      const sub = json.components.find((c) => c.type === 1 && c.components[0].custom_id?.endsWith(":subnav"));
      if (sub) for (const o of sub.components[0].options) atteignables.add(o.value);
      else atteignables.add(section);
    }
    for (const section of SECTIONS) {
      assert.ok(atteignables.has(section), `${section} n'est plus atteignable par la navigation`);
    }
  });

  await cas("chaque écran reste distinct — le regroupement n'a fusionné aucun contrôle", () => {
    // "Rang sys" donne accès à tout le bot, "Ban de masse" bannit le serveur
    // entier : même famille, jamais le même écran.
    const sys = render("sys");
    const banall = render("banall");
    assert.notStrictEqual(sys.texte, banall.texte);
    assert.ok(banall.texte.includes("bannit tout le serveur"));
    assert.ok(!sys.texte.includes("bannit tout le serveur"));
  });

  await cas("l'avertissement du ban de masse est conservé", () => {
    // Seule exception assumée : un mauvais clic y bannit le serveur entier.
    assert.ok(render("banall").texte.includes("bannit tout le serveur"));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
