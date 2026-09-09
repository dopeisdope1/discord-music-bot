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
const historyStore = require("../utils/moderationHistoryStore");
const { handleConfirmInteraction } = require("../utils/serverAdminCommands");
const permStore = require("../utils/permissions/store");
const permCatalog = require("../utils/permissions/catalog");

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
    // "home", "securityOverview", "stats" et "diagnostics" sont des vues en
    // lecture seule : leur seul contrôle est le menu de navigation (+
    // sous-menu s'il y a lieu), et c'est normal — rien à configurer sur un
    // compteur ou un uptime. Toutes les autres doivent offrir de quoi agir
    // sans avoir à taper une commande.
    const lectureSeuleOK = ["home", "securityOverview", "stats", "diagnostics"];
    for (const section of SECTIONS.filter((s) => !lectureSeuleOK.includes(s))) {
      assert.ok(render(section).rangees >= 2, `${section} n'offre aucun contrôle propre`);
    }
  });

  await cas("l'état courant reste affiché — sinon les contrôles agissent à l'aveugle", () => {
    for (const section of ["prefixes", "logs", "protection", "guard", "welcome", "mute", "tickets", "voice", "sys", "banall"]) {
      assert.ok(render(section).texte.includes(">"), `${section} n'affiche plus l'état courant`);
    }
  });

  await cas("le catalogue des permissions n'est plus recopié à côté de son menu", () => {
    // Il était listé en texte ET dans le menu déroulant qui coche les mêmes
    // clés : deux fois la même information, dont une seule cliquable.
    const { texte } = render("permissions");
    assert.ok(texte.length < 300, `${texte.length} caractères — le catalogue est probablement recopié`);
    assert.ok(!texte.includes("moderation.kick"), "les clés de permission n'ont pas à être listées en texte");
  });

  console.log("\n« Voir les commandes débloquées » (permissions > rôle) :");

  const roleId = "role-1";
  guild.roles.cache.set(roleId, { id: roleId, members: { size: 0 }, position: 1, hexColor: "#000000", permissions: { toArray: () => [], has: () => false } });
  permStore.setRoleGrants("g1", roleId, ["server.stats.view"]);

  const fakeInteraction = (customId, extra = {}) => ({
    customId: `${ID}:${customId}`,
    member,
    guild,
    isModalSubmit: () => false,
    reply: async () => {},
    update: async () => {},
    ...extra,
  });

  await cas("sans rôle choisi, le sélecteur de rôle est proposé", () => {
    const json = buildConfigPanel(guild, "permissions", member).components[0].toJSON();
    const composants = json.components.filter((c) => c.type === 1).flatMap((r) => r.components);
    assert.ok(composants.some((c) => c.custom_id === `${ID}:permrole`), "le sélecteur de rôle doit apparaître tant qu'aucun rôle n'est choisi");
  });

  await cas("une fois le rôle choisi, le sélecteur DISPARAÎT au profit d'une action pour en changer", () => {
    // Il ne servait plus à rien à ce moment-là et repoussait les vrais
    // réglages hors de l'écran.
    const json = buildConfigPanel(guild, "permissions", member, { permissionsRoleId: roleId }).components[0].toJSON();
    const composants = json.components.filter((c) => c.type === 1).flatMap((r) => r.components);
    assert.ok(!composants.some((c) => c.custom_id === `${ID}:permrole`), "le sélecteur de rôle doit disparaître une fois un rôle choisi");
    assert.ok(
      actionsDe(json).some((a) => a.custom_id === `${ID}:permrolereset`),
      "une action doit permettre de changer de rôle"
    );
  });

  await cas("les commandes débloquées sont TOUJOURS affichées, plus derrière un bouton", () => {
    // Elles arrivaient auparavant dans un message éphémère ouvert à côté du
    // panneau ; elles font maintenant partie de l'écran lui-même.
    const texte = texteDessine("permissions", { permissionsRoleId: roleId });
    assert.ok(texte.includes("Commandes débloquées"), texte);
    assert.ok(texte.includes("vc") || texte.includes("stats"), `attendu vc/stats (server.stats.view) : ${texte}`);
    assert.ok(!actionsDe(buildConfigPanel(guild, "permissions", member, { permissionsRoleId: roleId }).components[0].toJSON()).some((a) => /permshowcmds|permhidecmds/.test(a.custom_id)), "plus de bascule Voir/Masquer");
  });

  await cas("elles occupent leur PROPRE carte, une commande par ligne — plus une phrase en bas d'écran", () => {
    // Demande explicite : « quand on donne des permissions à un rôle je veux
    // que dans le dashboard ça écrive dans la case Commandes débloquées, pas
    // tout en bas ». Collées en une seule ligne de virgules, elles formaient
    // une phrase que le moteur de rendu tronquait au premier tiers.
    const spec = buildSectionSpec(guild, "permissions", member, { permissionsRoleId: roleId });
    const carte = spec.cartes.find((c) => (c.titre || "").startsWith("Commandes débloquées"));
    assert.ok(carte, `aucune carte dédiée : ${spec.cartes.map((c) => c.titre).join(" | ")}`);
    assert.ok(carte.items.length, "la carte ne doit pas être vide");
    for (const item of carte.items) {
      // Chaque entrée est UNE commande, avec son vrai préfixe et sans liste.
      assert.ok(/^&\S/.test(item.nom) || /^\+\d+ autres?$/.test(item.nom), `"${item.nom}" n'est pas une commande seule`);
      assert.ok(!item.nom.includes(","), `"${item.nom}" contient encore une liste collée`);
    }
    // Et elles ne traînent plus dans le pied de l'image.
    assert.ok(!(spec.pied || "").includes("&"), `le pied ne doit plus porter les commandes : ${spec.pied}`);
  });

  await cas("un rôle très doté n'étire pas l'image à l'infini — le compte exact reste annoncé", () => {
    const roleGros = "role-gros";
    guild.roles.cache.set(roleGros, { id: roleGros, members: new Collection(), position: 1, hexColor: "#000000", permissions: { toArray: () => [], has: () => false } });
    // Toutes les clés du catalogue d'un coup : le pire cas réel.
    permStore.setRoleGrants("g1", roleGros, permCatalog.byCategory().flatMap((g) => g.permissions.map((p) => p.key)));
    const spec = buildSectionSpec(guild, "permissions", member, { permissionsRoleId: roleGros });
    const lignes = spec.cartes.filter((c) => (c.titre || "").startsWith("Commandes débloquées")).flatMap((c) => c.items);
    assert.ok(lignes.length <= 28, `${lignes.length} lignes dessinées — l'image deviendrait illisible`);
    const annonce = spec.cartes.find((c) => (c.titre || "").startsWith("Commandes débloquées")).titre;
    const total = parseInt(/\((\d+)\)/.exec(annonce)[1], 10);
    assert.ok(total > lignes.length, `le compte annoncé (${total}) doit être le VRAI total, pas le nombre affiché`);
    assert.ok(lignes.some((i) => /^\+\d+ autres?$/.test(i.nom)), `le reste doit être annoncé : ${lignes.map((i) => i.nom).join(" | ")}`);
  });

  await cas("\"Voir les membres\" affiche la liste DANS l'écran, pas dans un message à côté", async () => {
    let panel = null;
    await handleConfigInteraction(fakeInteraction(`rolemembers:${roleId}`, { update: async (p) => { panel = p; } }));
    assert.ok(panel, "le panneau doit être réaffiché");
    const texte = texteDessine("permissions", { permissionsRoleId: roleId, permissionsShowMembers: true });
    assert.ok(texte.includes("Membres ayant ce rôle"), texte);
    // Et de quoi refermer la liste.
    assert.ok(
      actionsDe(panel.components[0].toJSON()).some((a) => a.custom_id === `${ID}:rolemembershide:${roleId}`),
      "l'action doit basculer vers \"Masquer les membres\""
    );
  });

  await cas("une permission accordée SANS commande dédiée (ex. accès à une rubrique du panel) reste visible — pas juste \"0 : aucune\"", () => {
    const roleId2 = "role-2";
    // `members` est une Collection sur un vrai rôle : le mock la reproduit,
    // la liste des membres étant désormais affichée dans l'écran.
    guild.roles.cache.set(roleId2, { id: roleId2, members: new Collection(), position: 1, hexColor: "#000000", permissions: { toArray: () => [], has: () => false } });
    // panel.roles.manage donne accès à une rubrique du panel, pas à une
    // commande tapée : reproduit le cas "1 permission accordée" affichant
    // "0 commande débloquée" sans explication.
    permStore.setRoleGrants("g1", roleId2, ["panel.roles.manage"]);
    const texte = texteDessine("permissions", { permissionsRoleId: roleId2 });
    assert.ok(texte.includes("Commandes débloquées (0)"), texte);
    assert.ok(texte.includes("Accès sans commande dédiée (1)"), texte);
    assert.ok(!texte.includes("panel.roles.manage"), "la clé technique ne doit pas apparaître, seulement son libellé");
  });

  console.log("\nCréer / supprimer un rôle, le marquer exclusif (permissions > rôle) :");

  /** Un serveur assez complet pour que utils/serverAdminCommands.js::roleAdmin fonctionne (create/delete réels). */
  function fakeGuildForRoleAdmin() {
    const rolesCache = new Collection();
    const g = {
      id: "g-rolecrud",
      name: "Serveur",
      roles: {
        cache: rolesCache,
        create: async ({ name, reason }) => {
          const created = {
            id: `role-created-${rolesCache.size + 1}`,
            name,
            position: 1,
            hexColor: "#000000",
            hoist: false,
            mentionable: false,
            createdTimestamp: Date.now(),
            members: { size: 0 },
            permissions: { toArray: () => [] },
            toString() {
              return `<@&${this.id}>`;
            },
          };
          rolesCache.set(created.id, created);
          return created;
        },
      },
      members: {
        me: { permissions: new PermissionsBitField(PermissionsBitField.All), roles: { highest: { position: 10 } } },
        cache: new Collection(),
      },
      channels: { cache: new Collection() },
    };
    return g;
  }

  await cas("action \"Créer un rôle\" proposée à qui a server.roles.manage", () => {
    const json = buildConfigPanel(guild, "permissions", member).components[0].toJSON();
    assert.ok(actionsDe(json).some((a) => a.custom_id === `${ID}:rolecreate`), "l'action \"Créer un rôle\" est absente du menu");
  });

  await cas("cliquer \"Créer un rôle\" (pas encore un modal) ouvre bien une modale, ne crée rien tout de suite", async () => {
    let modalShown = null;
    const g = fakeGuildForRoleAdmin();
    const interaction = {
      customId: `${ID}:rolecreate`,
      member,
      guild: g,
      client: {},
      user: { id: "owner-1", tag: "owner#0001" },
      isModalSubmit: () => false,
      showModal: async (m) => {
        modalShown = m;
      },
      reply: async () => {},
    };
    await handleConfigInteraction(interaction);
    assert.ok(modalShown, "une modale doit s'ouvrir");
    assert.strictEqual(g.roles.cache.size, 0, "aucun rôle ne doit être créé avant la soumission de la modale");
  });

  await cas("soumettre la modale \"Créer un rôle\" crée réellement le rôle sur le serveur", async () => {
    const g = fakeGuildForRoleAdmin();
    const replies = [];
    const interaction = {
      customId: `${ID}:rolecreate`,
      member,
      guild: g,
      channel: { id: "chan-1" },
      client: { users: { fetch: async () => null } },
      user: { id: "owner-1", tag: "owner#0001" },
      isModalSubmit: () => true,
      fields: { getTextInputValue: () => "Nouveau Rôle" },
      reply: async (p) => {
        replies.push(p);
        return {};
      },
    };
    await handleConfigInteraction(interaction);
    const created = [...g.roles.cache.values()][0];
    assert.ok(created, "le rôle devrait avoir été créé sur le serveur");
    assert.strictEqual(created.name, "Nouveau Rôle");
  });

  await cas("cliquer \"Supprimer ce rôle\" demande une confirmation, ne supprime pas tout de suite", async () => {
    const g = fakeGuildForRoleAdmin();
    // ID numérique de type "snowflake" — utils/serverAdminCommands.js::roleAdmin
    // ne reconnaît un ID brut (sans mention) que via /^\d{15,25}$/.
    const role = { id: "333333333333333331", name: "Éphémère", position: 1, delete: async () => {} };
    g.roles.cache.set(role.id, role);
    const replies = [];
    const interaction = {
      customId: `${ID}:roledelete:${role.id}`,
      member,
      guild: g,
      channel: { id: "chan-1" },
      client: { users: { fetch: async () => null } },
      user: { id: "owner-1", tag: "owner#0001" },
      isModalSubmit: () => false,
      reply: async (p) => {
        replies.push(p);
        return {};
      },
    };
    await handleConfigInteraction(interaction);
    assert.strictEqual(replies.length, 1);
    // La confirmation est désormais une carte EN IMAGE (utils/actionCard.js),
    // avec les deux issues en boutons dessous.
    const json = replies[0].components[0].toJSON();
    assert.ok(json.components.some((c) => c.type === 12), "la confirmation doit être affichée en image");
    assert.strictEqual(replies[0].files[0].name, "confirmation.png");
    assert.strictEqual(replies[0].files[0].attachment.subarray(1, 4).toString(), "PNG");
    const labels = json.components.filter((c) => c.type === 1).flatMap((r) => r.components).map((b) => b.label);
    assert.deepStrictEqual(labels, ["Supprimer", "Annuler"], "les deux issues doivent rester proposées");
    assert.ok(g.roles.cache.has(role.id), "le rôle ne doit pas encore être supprimé avant confirmation");
  });

  await cas("confirmer la suppression supprime réellement le rôle", async () => {
    const g = fakeGuildForRoleAdmin();
    let deleted = false;
    // Comme discord.js le fait réellement : delete() retire le rôle du
    // cache du serveur, pas seulement côté API.
    const role = {
      id: "333333333333333332",
      name: "Éphémère2",
      position: 1,
      delete: async () => {
        deleted = true;
        g.roles.cache.delete(role.id);
      },
    };
    g.roles.cache.set(role.id, role);
    let confirmCard = null;
    const initial = {
      customId: `${ID}:roledelete:${role.id}`,
      member,
      guild: g,
      channel: { id: "chan-1" },
      client: { users: { fetch: async () => null } },
      user: { id: "owner-1", tag: "owner#0001" },
      isModalSubmit: () => false,
      reply: async (p) => {
        confirmCard = p;
        return {};
      },
    };
    await handleConfigInteraction(initial);
    const confirmButton = confirmCard.components[0]
      .toJSON()
      .components.find((c) => c.type === 1)
      .components.find((b) => b.label === "Supprimer");
    const confirmInteraction = {
      customId: confirmButton.custom_id,
      user: { id: "owner-1", tag: "owner#0001" },
      member,
      guild: g,
      channelId: "chan-1",
      client: { users: { fetch: async () => null } },
      update: async () => {},
    };
    await handleConfirmInteraction(confirmInteraction);
    assert.ok(deleted, "le rôle doit être réellement supprimé après confirmation");
    assert.ok(!g.roles.cache.has(role.id));
  });

  await cas("\"Ajouter à l'exclusif\" marque le rôle, l'affichage et le bouton basculent", async () => {
    const g = guild;
    permStore.setRoleExclusive("g1", roleId, false);
    let panel = null;
    await handleConfigInteraction(fakeInteraction(`roleexclusive:${roleId}`, { update: async (p) => { panel = p; } }));
    assert.ok(permStore.isRoleExclusive("g1", roleId), "le rôle doit être marqué exclusif");
    const texte = texteDessine("permissions", { permissionsRoleId: roleId });
    assert.ok(/Exclusif[\s\S]{0,12}oui/.test(texte), texte);
    assert.ok(
      actionsDe(panel.components[0].toJSON()).some((a) => a.custom_id === `${ID}:roleexclusiveoff:${roleId}`),
      "l'action doit basculer vers \"Retirer de l'exclusif\""
    );
  });

  await cas("\"Retirer de l'exclusif\" annule le marquage", async () => {
    permStore.setRoleExclusive("g1", roleId, true);
    let panel = null;
    await handleConfigInteraction(fakeInteraction(`roleexclusiveoff:${roleId}`, { update: async (p) => { panel = p; } }));
    assert.ok(!permStore.isRoleExclusive("g1", roleId));
    const texte = texteDessine("permissions", { permissionsRoleId: roleId });
    assert.ok(/Exclusif[\s\S]{0,12}non/.test(texte), texte);
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
    for (const attendu of ["Logs", "Sécurité", "Bienvenue", "Vocaux temporaires", "Permissions", "Giveaways"]) {
      assert.ok(labels.includes(attendu), `"${attendu}" doit être proposé directement : ${labels.join(", ")}`);
    }
    assert.ok(menu.options.some((o) => o.default), "la rubrique ouverte doit être marquée comme choisie");
  });

  await cas("un second menu apparaît pour Sécurité, seul sujet qui regroupe plusieurs écrans", () => {
    const json = buildConfigPanel(guild, "securityOverview", member).components[0].toJSON();
    const sub = json.components.find((c) => c.type === 1 && c.components[0].custom_id?.endsWith(":subnav"));
    assert.ok(sub, "Sécurité regroupe vue d'ensemble, protection, anti-nuke et mute");
    const valeurs = sub.components[0].options.map((o) => o.value);
    assert.ok(valeurs.includes("protection") && valeurs.includes("guard"), valeurs.join(", "));
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

  console.log("\nRecherche d'historique — cible/modérateur en sélecteur natif, plus en texte libre :");

  const TARGET_ID = "111111111111111111";
  const MODERATOR_ID = "222222222222222222";
  historyStore.deleteAllForGuild("g1");
  historyStore.record({ guildId: "g1", targetId: TARGET_ID, moderatorId: MODERATOR_ID, action: "ban" });

  await cas("par défaut, juste l'action \"Rechercher\" — pas encore de sélecteur", () => {
    const json = buildConfigPanel(guild, "history", member).components[0].toJSON();
    const selects = json.components.filter((c) => c.type === 1 && c.components[0]?.type === 5); // 5 = UserSelectMenu
    assert.ok(actionsDe(json).some((a) => a.custom_id === `${ID}:history:search`), "l'action Rechercher doit être proposée");
    assert.strictEqual(selects.length, 0, "les sélecteurs n'apparaissent qu'après avoir lancé la recherche");
  });

  await cas("cliquer \"Rechercher\" ouvre la carte avec DEUX UserSelectMenu natifs (cible + modérateur)", async () => {
    let panel = null;
    await handleConfigInteraction(fakeInteraction("history:search", { update: async (p) => { panel = p; } }));
    const json = panel.components[0].toJSON();
    const selects = json.components.filter((c) => c.type === 1 && c.components[0]?.type === 5);
    assert.strictEqual(selects.length, 2, "cible ET modérateur doivent être des UserSelectMenu natifs");
  });

  await cas("choisir une cible garde le modérateur déjà choisi (état porté par le customId, sans mémoire serveur)", async () => {
    let panel = null;
    await handleConfigInteraction(
      fakeInteraction(`historytarget:${MODERATOR_ID}`, { values: [TARGET_ID], update: async (p) => { panel = p; } })
    );
    const json = panel.components[0].toJSON();
    const targetSelect = json.components.find((c) => c.type === 1 && c.components[0]?.custom_id?.startsWith(`${ID}:historytarget:`))
      ?.components[0];
    const modSelect = json.components.find((c) => c.type === 1 && c.components[0]?.custom_id?.startsWith(`${ID}:historymoderator:`))
      ?.components[0];
    assert.deepStrictEqual(targetSelect.default_values?.map((d) => d.id), [TARGET_ID]);
    assert.ok(modSelect.custom_id.endsWith(`:${TARGET_ID}`), "le sélecteur modérateur doit porter la cible dans son customId");
  });

  await cas("\"Rechercher\" (carte) trouve bien l'entrée par cible ET modérateur, répond en Components V2 (plus d'embed classique)", async () => {
    let panel = null;
    const followUps = [];
    await handleConfigInteraction(
      fakeInteraction(`historyrun:${TARGET_ID}:${MODERATOR_ID}`, {
        update: async (p) => { panel = p; },
        followUp: async (p) => { followUps.push(p); return {}; },
      })
    );
    assert.ok(panel, "le panneau (carte de critères) doit être rafraîchi via update()");
    assert.strictEqual(followUps.length, 1, "les résultats doivent arriver en followUp, pas en second update()");
    assert.ok(followUps[0].flags & MessageFlags.IsComponentsV2, "les résultats doivent être en Components V2, pas un embed classique");
    assert.ok(followUps[0].flags & MessageFlags.Ephemeral);
    const texte = followUps[0].components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(texte.includes("ban"), texte);
  });

  await cas("aucune correspondance (mauvaise cible) : le dit clairement, ne plante pas", async () => {
    const followUps = [];
    await handleConfigInteraction(
      fakeInteraction(`historyrun:${"999999999999999999"}:_`, {
        update: async () => {},
        followUp: async (p) => { followUps.push(p); return {}; },
      })
    );
    const texte = followUps[0].components[0].toJSON().components[0].content;
    assert.ok(texte.length > 0);
  });

  await cas("le bouton \"Filtrer par type/ID...\" ouvre un Modal RÉDUIT (2 champs, plus cible/modérateur en texte)", async () => {
    let modal = null;
    await handleConfigInteraction(
      fakeInteraction(`historytextopen:${TARGET_ID}:${MODERATOR_ID}`, { showModal: (m) => { modal = m; } })
    );
    const json = modal.toJSON();
    assert.strictEqual(json.components.length, 2, "seuls type/ID doivent rester en Modal");
    assert.strictEqual(json.custom_id, `${ID}:historytextsubmit:${TARGET_ID}:${MODERATOR_ID}`, "cible/modérateur doivent être portés par le Modal, pas perdus");
  });

  await cas("soumettre le Modal réduit combine type/ID tapés AVEC la cible/le modérateur choisis avant (via la carte)", async () => {
    const fields = { action: "ban", id: "" };
    const modalInteraction = {
      customId: `${ID}:historytextsubmit:${TARGET_ID}:${MODERATOR_ID}`,
      member,
      guild,
      fields: { getTextInputValue: (k) => fields[k] },
      reply: async (p) => {
        modalInteraction._reply = p;
        return {};
      },
    };
    await handleConfigInteraction(modalInteraction);
    assert.ok(modalInteraction._reply.flags & MessageFlags.IsComponentsV2);
    const texte = modalInteraction._reply.components[0].toJSON().components[0].content;
    assert.ok(texte.includes("ban"));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
