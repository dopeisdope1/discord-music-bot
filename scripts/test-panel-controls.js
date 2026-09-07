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
const { buildConfigPanel, handleConfigInteraction, handleHistorySearchModal, ID, SECTIONS: SECTIONS_META } = require("../utils/configPanel");
const historyStore = require("../utils/moderationHistoryStore");
const { handleConfirmInteraction } = require("../utils/serverAdminCommands");
const permStore = require("../utils/permissions/store");

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

function render(section, state) {
  const json = buildConfigPanel(guild, section, member, state).components[0].toJSON();
  return {
    texte: json.components.filter((c) => c.type === 10).map((c) => c.content).join("\n"),
    rangees: json.components.filter((c) => c.type === 1).length,
  };
}

(async () => {
  console.log("Le panel montre, il n'explique pas :");

  await cas("aucune rubrique ne dépasse 900 caractères de texte", () => {
    for (const section of SECTIONS) {
      const { texte } = render(section);
      assert.ok(texte.length <= 900, `${section} affiche ${texte.length} caractères — c'est de la documentation, pas un écran de contrôle`);
    }
  });

  await cas("chaque rubrique propose au moins le menu de navigation", () => {
    for (const section of SECTIONS) {
      assert.ok(render(section).rangees >= 1, `${section} n'a aucun contrôle`);
    }
  });

  await cas("toutes les rubriques de réglage ont un contrôle en plus de la navigation", () => {
    // "home" et "securityOverview" sont des vues d'ensemble en lecture
    // seule : leur seul contrôle est le menu de navigation (+ sous-menu pour
    // la seconde), et c'est normal — le détail actionnable vit dans les
    // rubriques qu'elles résument. Toutes les autres doivent offrir de quoi
    // agir sans avoir à taper une commande.
    for (const section of SECTIONS.filter((s) => s !== "home" && s !== "securityOverview")) {
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

  await cas("sans rôle choisi, aucun bouton \"voir les commandes débloquées\"", () => {
    const json = buildConfigPanel(guild, "permissions", member).components[0].toJSON();
    const boutons = json.components.filter((c) => c.type === 1).flatMap((r) => r.components);
    assert.ok(!boutons.some((b) => b.custom_id?.includes("permshowcmds")), "le bouton ne devrait apparaître qu'une fois un rôle choisi");
  });

  await cas("un rôle choisi affiche le bouton \"Voir les commandes débloquées\"", () => {
    const json = buildConfigPanel(guild, "permissions", member, { permissionsRoleId: roleId }).components[0].toJSON();
    const boutons = json.components.filter((c) => c.type === 1).flatMap((r) => r.components);
    const bouton = boutons.find((b) => b.custom_id === `${ID}:permshowcmds:${roleId}`);
    assert.ok(bouton, "le bouton \"voir les commandes débloquées\" est absent");
    assert.strictEqual(bouton.label, "Voir les commandes débloquées");
  });

  await cas("le comptage par catégorie ne dit QUE le nombre, jamais les commandes elles-mêmes", () => {
    const { texte } = render("permissions", { permissionsRoleId: roleId });
    assert.ok(texte.includes("Permissions du bot accordées"), texte);
    assert.ok(!texte.includes("Commandes débloquées par ce rôle"), "sans avoir cliqué sur le bouton, la liste ne doit pas apparaître");
    assert.ok(!texte.includes("`vc`"), "sans le bouton cliqué, aucune commande nommée ne doit apparaître");
  });

  await cas("cliquer sur le bouton révèle les VRAIES commandes débloquées, pas juste un compte", async () => {
    let panel = null;
    await handleConfigInteraction(
      fakeInteraction(`permshowcmds:${roleId}`, { update: async (p) => { panel = p; } })
    );
    const texte = panel.components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(texte.includes("Commandes débloquées par ce rôle"), texte);
    assert.ok(texte.includes("`vc`") || texte.includes("`stats`"), `attendu vc/stats (server.stats.view) : ${texte}`);
  });

  await cas("un second clic (déjà affiché) bascule vers \"Masquer\" et referme la liste", async () => {
    let panel = null;
    await handleConfigInteraction(
      fakeInteraction(`permhidecmds:${roleId}`, { update: async (p) => { panel = p; } })
    );
    const texte = panel.components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(!texte.includes("Commandes débloquées par ce rôle"), "la liste devrait être repliée après un second clic");
    const boutons = panel.components[0].toJSON().components.filter((c) => c.type === 1).flatMap((r) => r.components);
    const bouton = boutons.find((b) => b.custom_id === `${ID}:permshowcmds:${roleId}`);
    assert.ok(bouton, "le bouton doit repasser à \"Voir les commandes débloquées\" une fois replié");
  });

  await cas("une permission accordée SANS commande dédiée (ex. accès à une rubrique du panel) reste visible — pas juste \"0 : aucune\"", () => {
    const roleId2 = "role-2";
    guild.roles.cache.set(roleId2, { id: roleId2, members: { size: 0 }, position: 1, hexColor: "#000000", permissions: { toArray: () => [], has: () => false } });
    // panel.roles.manage donne accès à une rubrique du panel, pas à une
    // commande tapée : reproduit le cas "1 permission accordée" affichant
    // "0 commande débloquée" sans explication.
    permStore.setRoleGrants("g1", roleId2, ["panel.roles.manage"]);
    const { texte } = render("permissions", { permissionsRoleId: roleId2, permissionsShowCommands: true });
    assert.ok(texte.includes("Commandes débloquées par ce rôle (0)"), texte);
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

  await cas("bouton \"Créer un rôle\" visible pour qui a server.roles.manage", () => {
    const json = buildConfigPanel(guild, "permissions", member).components[0].toJSON();
    const boutons = json.components.filter((c) => c.type === 1).flatMap((r) => r.components);
    const bouton = boutons.find((b) => b.custom_id === `${ID}:rolecreate`);
    assert.ok(bouton, "le bouton \"Créer un rôle\" est absent");
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
    const texte = replies[0].components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(texte.includes("Confirmer la suppression du rôle"), texte);
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
    const texte = panel.components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(texte.includes("**Exclusif** : oui"), texte);
    const boutons = panel.components[0].toJSON().components.filter((c) => c.type === 1).flatMap((r) => r.components);
    assert.ok(boutons.some((b) => b.custom_id === `${ID}:roleexclusiveoff:${roleId}`), "le bouton doit basculer vers \"Retirer de l'exclusif\"");
  });

  await cas("\"Retirer de l'exclusif\" annule le marquage", async () => {
    permStore.setRoleExclusive("g1", roleId, true);
    let panel = null;
    await handleConfigInteraction(fakeInteraction(`roleexclusiveoff:${roleId}`, { update: async (p) => { panel = p; } }));
    assert.ok(!permStore.isRoleExclusive("g1", roleId));
    const texte = panel.components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(texte.includes("**Exclusif** : non"), texte);
  });

  console.log("\nNavigation regroupée par famille :");

  await cas("le menu principal propose des familles, pas les 16 rubriques", () => {
    const json = buildConfigPanel(guild, "home", member).components[0].toJSON();
    const nav = json.components.find((c) => c.type === 1 && c.components[0].custom_id?.endsWith(":nav"));
    assert.ok(nav, "le menu de navigation doit exister");
    // Onze familles cibles au maximum (voir le plan de refonte du panel) —
    // le plafond suit ce nombre, pas un chiffre arbitraire.
    assert.ok(nav.components[0].options.length <= 11, `${nav.components[0].options.length} entrées — c'est de nouveau une liste à faire défiler`);
    assert.ok(nav.components[0].options.length < SECTIONS.length, "il doit y avoir moins de familles que de rubriques");
  });

  await cas("un second menu apparaît pour choisir dans une famille qui en contient plusieurs", () => {
    const json = buildConfigPanel(guild, "sys", member).components[0].toJSON();
    const sub = json.components.find((c) => c.type === 1 && c.components[0].custom_id?.endsWith(":subnav"));
    assert.ok(sub, "la famille Permissions et accès contient plusieurs rubriques");
    const valeurs = sub.components[0].options.map((o) => o.value);
    assert.ok(valeurs.includes("sys") && valeurs.includes("banall"));
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

  await cas("par défaut, juste le bouton \"Rechercher\" — pas encore de sélecteur", () => {
    const json = buildConfigPanel(guild, "history", member).components[0].toJSON();
    const boutons = json.components.filter((c) => c.type === 1 && c.components[0]?.type === 2).flatMap((r) => r.components);
    const selects = json.components.filter((c) => c.type === 1 && c.components[0]?.type === 5); // 5 = UserSelectMenu
    assert.ok(boutons.some((b) => b.custom_id === `${ID}:history:search`));
    assert.strictEqual(selects.length, 0);
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
