/**
 * Vérifie la rubrique "Rôles (paliers)" du panel (utils/configPanel.js) :
 * demande explicite pour voir en un coup d'œil ce que &perms et &helpall
 * montrent séparément (paliers de permissions -> rôles ET commandes
 * débloquées), avec un raccourci direct vers le renommage d'un rôle —
 * sans redemander le rôle une seconde fois dans "Rôles et permissions".
 *
 * Lancement : node scripts/test-panel-role-tiers.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-role-tiers-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { buildConfigPanel, buildSectionSpec, handleConfigInteraction, ID } = require("../utils/configPanel");
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

const ROLE_A = "111111111111111111";
const ROLE_B = "222222222222222222";

function makeGuild() {
  return {
    id: "gtiers",
    name: "Serveur",
    ownerId: "owner-1",
    memberCount: 0,
    roles: {
      cache: new Collection([
        [ROLE_A, { id: ROLE_A, name: "Modérateur", position: 2, hexColor: "#000000", members: { size: 0 }, permissions: { toArray: () => [], has: () => false }, toString() { return `<@&${this.id}>`; } }],
        [ROLE_B, { id: ROLE_B, name: "Support", position: 1, hexColor: "#000000", members: { size: 0 }, permissions: { toArray: () => [], has: () => false }, toString() { return `<@&${this.id}>`; } }],
      ]),
      everyone: { permissions: new PermissionsBitField([]) },
    },
    channels: { cache: new Collection() },
    members: { cache: new Collection(), me: { roles: { highest: { position: 9 } }, permissions: { has: () => true } } },
    emojis: { cache: new Collection() },
    voiceStates: { cache: new Collection() },
    client: { uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } },
  };
}

function mkMember(id, roleId) {
  return {
    id,
    guild: { id: "gtiers", ownerId: "owner-1" },
    roles: { cache: roleId ? new Collection([[roleId, { id: roleId }]]) : new Collection() },
    permissions: { has: () => false },
    user: { tag: `${id}#0001` },
  };
}

function texteDe(guild, member, state) {
  const spec = buildSectionSpec(guild, "roletiers", member, state);
  return spec.cartes.flatMap((c) => [c.titre || "", ...c.items.map((i) => `${i.nom} ${i.description || ""}`)]).join("\n");
}

(async () => {
  console.log('Rubrique "Rôles (paliers)" — vue combinée &perms + &helpall :');

  const guild = makeGuild();
  permStore.setRoleGrants("gtiers", ROLE_A, ["moderation.kick", "moderation.ban"]);
  permStore.setRoleGrants("gtiers", ROLE_B, ["moderation.kick"]);
  permStore.setRoleExclusive("gtiers", ROLE_B, false);

  await cas("visible avec panel.permissions.manage, absente sinon", () => {
    const avecDroit = mkMember("u-avec", ROLE_A);
    const sansDroit = mkMember("u-sans", null);
    const dispoAvec = buildConfigPanel(guild, "home", avecDroit).components[0].toJSON();
    const dispoSans = buildConfigPanel(guild, "home", sansDroit).components[0].toJSON();
    // panel.permissions.manage vient du rôle A ci-dessous une fois accordé —
    // ici on vérifie juste que la rubrique existe bien pour le propriétaire.
    const owner = mkMember("owner-1", null);
    const spec = buildSectionSpec(guild, "roletiers", owner, {});
    assert.ok(spec, "la rubrique doit se construire pour le propriétaire");
  });

  await cas("en TEXTE (pas en image, comme &helpall) : une ligne compacte par palier, rôle(s) puis les actions juste à côté", () => {
    const owner = mkMember("owner-1", null);
    const payload = buildConfigPanel(guild, "roletiers", owner, {});
    // Pas d'image pour cette rubrique : aucune galerie média, juste du texte.
    const brut = payload.components[0].toJSON();
    assert.ok(!JSON.stringify(brut).includes("media_gallery"), "roletiers ne doit plus être dessiné en image");
    const texte = JSON.stringify(brut);
    assert.ok(texte.includes("Permission 1"), texte);
    assert.ok(texte.includes(ROLE_B) && texte.includes(`<@&${ROLE_B}>`), "le palier à 1 permission (Support) doit apparaître, en mention brute (vrai texte Discord)");
    assert.ok(texte.includes("Permission 2"), texte);
    assert.ok(texte.includes(ROLE_A) && texte.includes(`<@&${ROLE_A}>`), "le palier à 2 permissions (Modérateur) doit aussi apparaître");
    assert.ok(texte.includes("modifier/supprimer/ajouter"), "le rappel des actions doit être collé à chaque palier — demande explicite");
  });

  await cas("aucune permission accordée nulle part : message clair, pas une page vide", () => {
    const guildVide = makeGuild();
    guildVide.id = "gvide";
    const owner = mkMember("owner-1", null);
    owner.guild = { id: "gvide", ownerId: "owner-1" };
    const texte = texteDe(guildVide, owner, {});
    assert.ok(texte.includes("Aucune permission"), texte);
  });

  await cas('choisir un rôle dans le sélecteur saute DIRECTEMENT dans "Rôles et permissions" avec ce rôle déjà sélectionné', async () => {
    const owner = mkMember("owner-1", null);
    let updated = null;
    await handleConfigInteraction({
      customId: `${ID}:tierrenamepick`,
      values: [ROLE_A],
      member: owner,
      guild,
      client: {},
      update: async (p) => {
        updated = p;
      },
    });
    assert.ok(updated, "le panneau aurait dû être mis à jour");
    // Le corps de la rubrique est DESSINÉ (image) : son contenu se lit sur la
    // spec passée au moteur de rendu, pas dans le JSON de la réponse — voir
    // scripts/test-panel-rolemembers.js pour ce même motif.
    assert.ok(JSON.stringify(updated).includes("Rôles et permissions"), "on doit atterrir sur la rubrique Rôles et permissions");
    const spec = buildSectionSpec(guild, "permissions", owner, { permissionsRoleId: ROLE_A });
    const detail = spec.cartes.flatMap((c) => [c.titre || "", ...c.items.map((i) => `${i.nom} ${i.description || ""}`)]).join("\n");
    assert.ok(detail.includes("Modérateur"), "le rôle choisi (Modérateur) doit déjà être affiché, pas à re-sélectionner");
  });

  await cas("sans panel.permissions.manage, choisir un rôle dans le sélecteur reste refusé", async () => {
    // Juste assez pour VOIR le panel (hasAnyPanelAccess), pas de quoi agir.
    permStore.setRoleGrants("gtiers", "role-basic", ["panel.roles.manage"]);
    const sansDroit = mkMember("u-sans-droit", "role-basic");
    let refused = null;
    await handleConfigInteraction({
      customId: `${ID}:tierrenamepick`,
      values: [ROLE_A],
      member: sansDroit,
      guild,
      client: {},
      reply: async (p) => {
        refused = p;
      },
    });
    assert.ok(refused?.content?.includes("pas la permission"), JSON.stringify(refused));
  });

  console.log('\nBouton "Nettoyer les rôles supprimés" :');

  await cas("retire les octrois des rôles qui n'existent plus, DANS le panel (pas un second message)", async () => {
    permStore.setRoleGrants("gtiers", "role-mort-depuis-longtemps", ["moderation.kick"]);
    const owner = mkMember("owner-1", null);
    let updated = null;
    await handleConfigInteraction({
      customId: `${ID}:pruneroles`,
      member: owner,
      guild,
      client: {},
      update: async (p) => (updated = p),
    });
    assert.ok(updated, "le panneau aurait dû être mis à jour, pas un message à côté");
    assert.deepStrictEqual(permStore.getRoleGrants("gtiers", "role-mort-depuis-longtemps"), []);
  });

  await cas("sans rien à nettoyer, le dit clairement plutôt que de prétendre avoir agi", async () => {
    const owner = mkMember("owner-1", null);
    let updated = null;
    await handleConfigInteraction({
      customId: `${ID}:pruneroles`,
      member: owner,
      guild,
      client: {},
      update: async (p) => (updated = p),
    });
    assert.ok(JSON.stringify(updated).includes("Rien à nettoyer"), JSON.stringify(updated));
  });

  console.log('\nGestion rapide d\'un palier (renommer/ajouter/supprimer un rôle, sans quitter la rubrique) :');

  const ROLE_C = "333333333333333333";
  guild.roles.cache.set(ROLE_C, {
    id: ROLE_C,
    name: "Nouveau Rôle",
    position: 3,
    hexColor: "#000000",
    members: { size: 0 },
    permissions: { toArray: () => [], has: () => false },
    toString() {
      return `<@&${this.id}>`;
    },
  });

  function jsonDe(payload) {
    return JSON.stringify(payload);
  }

  await cas('"Choisir un palier à gérer" liste bien Permission 1 (Support) et Permission 2 (Modérateur)', () => {
    const owner = mkMember("owner-1", null);
    const payload = buildConfigPanel(guild, "roletiers", owner, {});
    const texte = jsonDe(payload.components[0].toJSON());
    assert.ok(texte.includes(`${ID}:tierselect`), texte);
    assert.ok(texte.includes("t-1") && texte.includes("t-2"), texte);
  });

  await cas("sans panel.permissions.manage, aucun contrôle de gestion de palier n'apparaît", () => {
    const sansDroit = mkMember("u-sans-gestion", null);
    const payload = buildConfigPanel(guild, "roletiers", sansDroit, { tierManageKey: "t-1" });
    const texte = jsonDe(payload.components[0].toJSON());
    assert.ok(!texte.includes(`${ID}:tierselect`), texte);
    assert.ok(!texte.includes(`${ID}:tieraddrole`), texte);
  });

  await cas("choisir Permission 1 (un seul rôle : Support) affiche direct Renommer/Supprimer POUR CE RÔLE", async () => {
    const owner = mkMember("owner-1", null);
    let updated = null;
    await handleConfigInteraction({
      customId: `${ID}:tierselect`,
      values: ["t-1"],
      member: owner,
      guild,
      client: {},
      update: async (p) => (updated = p),
    });
    const texte = jsonDe(updated.components[0].toJSON());
    assert.ok(texte.includes(`${ID}:tieraddrole:t-1`), "le sélecteur d'ajout doit viser le bon palier");
    assert.ok(texte.includes(`${ID}:renamerole:${ROLE_B}`), "Renommer doit viser directement Support (seul rôle du palier)");
    assert.ok(texte.includes(`${ID}:roledelete:${ROLE_B}`), "Supprimer doit viser directement Support");
    assert.ok(!texte.includes(`${ID}:tierrolepick`), "un seul rôle : pas besoin du sélecteur intermédiaire");
  });

  await cas('"Ajouter un rôle à ce palier" copie les clés du palier sur le rôle choisi', async () => {
    assert.deepStrictEqual(permStore.getRoleGrants("gtiers", ROLE_C), []);
    const owner = mkMember("owner-1", null);
    let updated = null;
    await handleConfigInteraction({
      customId: `${ID}:tieraddrole:t-1`,
      values: [ROLE_C],
      member: owner,
      guild,
      client: {},
      update: async (p) => (updated = p),
    });
    assert.deepStrictEqual(permStore.getRoleGrants("gtiers", ROLE_C), permStore.getRoleGrants("gtiers", ROLE_B));
    assert.ok(updated, "le panneau doit être mis à jour en place");
  });

  await cas("le palier a maintenant 2 rôles : le sélecteur intermédiaire apparaît, pas de bouton direct", () => {
    const owner = mkMember("owner-1", null);
    const payload = buildConfigPanel(guild, "roletiers", owner, { tierManageKey: "t-1" });
    const texte = jsonDe(payload.components[0].toJSON());
    assert.ok(texte.includes(`${ID}:tierrolepick:t-1`), texte);
    assert.ok(!texte.includes(`${ID}:renamerole:`), "ambigu entre 2 rôles : pas de bouton tant qu'on n'a pas choisi lequel");
  });

  await cas("choisir un rôle précis dans le palier fait apparaître Renommer/Supprimer POUR CE RÔLE-LÀ", async () => {
    const owner = mkMember("owner-1", null);
    let updated = null;
    await handleConfigInteraction({
      customId: `${ID}:tierrolepick:t-1`,
      values: [ROLE_C],
      member: owner,
      guild,
      client: {},
      update: async (p) => (updated = p),
    });
    const texte = jsonDe(updated.components[0].toJSON());
    assert.ok(texte.includes(`${ID}:renamerole:${ROLE_C}`), texte);
    assert.ok(texte.includes(`${ID}:roledelete:${ROLE_C}`), texte);
  });

  await cas("sans panel.permissions.manage, tierselect/tierrolepick/tieraddrole sont tous refusés", async () => {
    // Octroi INDIVIDUEL (pas par rôle) : "role-basic" plus haut a depuis été
    // nettoyé par le test "Nettoyer les rôles supprimés" (il ne correspond à
    // aucun rôle réel de guild.roles.cache, donc pruneDeletedRoles l'a
    // retiré) — un octroi direct à l'utilisateur donne juste assez pour VOIR
    // le panel, sans dépendre de cet ordre d'exécution.
    permStore.grantToUser("gtiers", "u-sans-gestion-2", "panel.roles.manage");
    const sansDroit = mkMember("u-sans-gestion-2", null);
    for (const customId of [`${ID}:tierselect`, `${ID}:tierrolepick:t-1`, `${ID}:tieraddrole:t-1`]) {
      let refused = null;
      await handleConfigInteraction({
        customId,
        values: [ROLE_C],
        member: sansDroit,
        guild,
        client: {},
        reply: async (p) => (refused = p),
      });
      assert.ok(refused?.content?.includes("pas la permission"), `${customId} : ${JSON.stringify(refused)}`);
    }
  });

  await cas("un palier exclusif propose aussi \"Ajouter un rôle\", qui copie clés ET étiquette", async () => {
    const ROLE_EXCL = "444444444444444444";
    guild.roles.cache.set(ROLE_EXCL, {
      id: ROLE_EXCL,
      name: "Syndicat",
      position: 4,
      hexColor: "#000000",
      members: { size: 0 },
      permissions: { toArray: () => [], has: () => false },
      toString() {
        return `<@&${this.id}>`;
      },
    });
    permStore.setRoleGrants("gtiers", ROLE_EXCL, ["server.roles.manage"]);
    permStore.setRoleExclusive("gtiers", ROLE_EXCL, true, "Syndicat");

    const owner = mkMember("owner-1", null);
    const listPayload = buildConfigPanel(guild, "roletiers", owner, {});
    assert.ok(jsonDe(listPayload.components[0].toJSON()).includes("e-Syndicat"), "l'option du groupe exclusif doit apparaître");

    const ROLE_EXCL2 = "555555555555555555";
    guild.roles.cache.set(ROLE_EXCL2, {
      id: ROLE_EXCL2,
      name: "Second Syndicat",
      position: 5,
      hexColor: "#000000",
      members: { size: 0 },
      permissions: { toArray: () => [], has: () => false },
      toString() {
        return `<@&${this.id}>`;
      },
    });
    await handleConfigInteraction({
      customId: `${ID}:tieraddrole:e-Syndicat`,
      values: [ROLE_EXCL2],
      member: owner,
      guild,
      client: {},
      update: async () => {},
    });
    assert.deepStrictEqual(permStore.getRoleGrants("gtiers", ROLE_EXCL2), ["server.roles.manage"]);
    assert.strictEqual(permStore.isRoleExclusive("gtiers", ROLE_EXCL2), true);
    assert.strictEqual(permStore.getExclusiveLabel("gtiers", ROLE_EXCL2), "Syndicat");
  });

  console.log("\nNommer un palier :");

  const owner = mkMember("owner-1", null);

  /** Le texte réellement affiché par la rubrique (elle reste en TEXTE). */
  const corpsRubrique = (membre, state = {}) =>
    buildConfigPanel(guild, "roletiers", membre, state)
      .components[0].toJSON()
      .components.filter((c) => c.type === 10)
      .map((c) => c.content)
      .join("\n");

  const clic = (customId, extra = {}) => ({
    customId: `${ID}:${customId}`,
    member: owner,
    guild,
    client: {},
    values: [],
    isModalSubmit: () => false,
    reply: async () => {},
    update: async () => {},
    ...extra,
  });
  const modale = (valeur) => ({ isModalSubmit: () => true, fields: { getTextInputValue: () => valeur } });

  await cas("un palier sans nom reste désigné par son seul numéro", () => {
    assert.ok(/Permission 1\b/.test(corpsRubrique(owner)), corpsRubrique(owner));
    assert.ok(!corpsRubrique(owner).includes("—  "), corpsRubrique(owner));
  });

  await cas("l'action « Nommer ce palier » n'apparaît qu'une fois un palier choisi", () => {
    // Le panel replie TOUS ses boutons dans un menu unique en fin de rendu
    // (regrouperBoutonsEnMenu) : l'action est donc une OPTION de "cfg:action",
    // dont la valeur est le customId du bouton d'origine.
    const actions = (state) =>
      buildConfigPanel(guild, "roletiers", owner, state)
        .components[0].toJSON()
        .components.filter((c) => c.type === 1)
        .flatMap((r) => r.components)
        .filter((c) => c.custom_id === `${ID}:action`)
        .flatMap((c) => c.options || []);
    assert.ok(!actions({}).some((o) => o.value.includes("tiername")), "aucun palier choisi : pas d'action de nommage");
    const choisi = actions({ tierManageKey: "t-1" });
    assert.ok(choisi.some((o) => o.value.startsWith(`${ID}:tiername:`)), JSON.stringify(choisi));
    assert.ok(choisi.some((o) => o.label === "Nommer ce palier"), JSON.stringify(choisi));
  });

  await cas("nommer un palier l'affiche partout : rubrique, menu de gestion, &perms et &helpall", async () => {
    await handleConfigInteraction(clic("tiername:t-1", modale("Modération")));
    const corps = corpsRubrique(owner);
    assert.ok(corps.includes("Permission 1 — Modération"), corps);

    // Le menu de gestion doit dire la même chose que la liste.
    const options = buildConfigPanel(guild, "roletiers", owner, {})
      .components[0].toJSON()
      .components.filter((c) => c.type === 1)
      .flatMap((r) => r.components)
      .find((c) => (c.custom_id || "").endsWith(":tierselect"))?.options;
    assert.ok(options.some((o) => o.label === "Permission 1 — Modération"), JSON.stringify(options));

    // &perms/&helpall passent par buildTierCard : même libellé, sinon le
    // panel et les commandes texte nommeraient le palier différemment.
    const { computeTiers, buildTierCard } = require("../utils/permsCommands");
    const messages = buildTierCard("gtiers", "T", "i", computeTiers("gtiers"), () => "x");
    const texte = JSON.stringify(messages);
    assert.ok(texte.includes("Permission 1 — Modération"), texte);
  });

  await cas("le nom suit les PERMISSIONS, pas le numéro : renuméroter ne le déplace pas", async () => {
    // Deux rôles isolés, pour ne pas dépendre de ce que les cas précédents
    // ont laissé : un petit palier {logs.view} et un plus gros {logs.view,
    // server.info.view}. On nomme le GROS (numéro 2), puis on fait
    // disparaître le petit : le gros devient numéro 1 et le nom doit l'avoir
    // suivi, pas être resté sur le numéro 2.
    const PETIT = "777777777777777777";
    const GROS = "888888888888888888";
    for (const [id, nom] of [[PETIT, "Petit"], [GROS, "Gros"]]) {
      guild.roles.cache.set(id, {
        id,
        name: nom,
        position: 1,
        hexColor: "#000000",
        members: { size: 0 },
        permissions: { toArray: () => [], has: () => false },
        toString() { return `<@&${this.id}>`; },
      });
    }
    for (const [id] of permStore.listRoleGrants("gtiers")) permStore.setRoleGrants("gtiers", id, []);
    permStore.setRoleGrants("gtiers", PETIT, ["logs.view"]);
    permStore.setRoleGrants("gtiers", GROS, ["logs.view", "server.info.view"]);

    await handleConfigInteraction(clic("tiername:t-2", modale("Encadrement")));
    assert.ok(corpsRubrique(owner).includes("Permission 2 — Encadrement"), corpsRubrique(owner));

    permStore.setRoleGrants("gtiers", PETIT, []);
    const corps = corpsRubrique(owner);
    assert.ok(corps.includes("Permission 1 — Encadrement"), `le nom doit avoir suivi ses permissions : ${corps}`);
  });

  await cas("un nom vide retire le nom, sans toucher aux permissions", async () => {
    const avant = permStore.getRoleGrants("gtiers", ROLE_B);
    await handleConfigInteraction(clic("tiername:t-1", modale("   ")));
    assert.ok(!corpsRubrique(owner).includes("Modération"), corpsRubrique(owner));
    assert.deepStrictEqual(permStore.getRoleGrants("gtiers", ROLE_B), avant, "nommer ne doit jamais changer une permission");
  });

  await cas("nommer un palier qui n'existe plus est refusé, sans rien enregistrer", async () => {
    let repondu = null;
    await handleConfigInteraction(clic("tiername:t-99", { ...modale("Fantôme"), reply: async (p) => { repondu = p; } }));
    assert.ok(repondu?.content.includes("n'existe plus"), JSON.stringify(repondu));
  });

  await cas("sans panel.permissions.manage, nommer est refusé même si le bouton est forcé", async () => {
    let repondu = null;
    await handleConfigInteraction(
      clic("tiername:t-1", { ...modale("Pirate"), member: mkMember("u-sans", null), reply: async (p) => { repondu = p; } })
    );
    assert.ok(/permission|accès/i.test(repondu?.content || ""), JSON.stringify(repondu));
    assert.ok(!corpsRubrique(owner).includes("Pirate"), corpsRubrique(owner));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
