/**
 * Vérifie la rubrique "Rôles (paliers)" du panel (utils/configPanel.js) :
 * demande explicite pour voir en un coup d'œil tous les paliers de
 * permissions ET leurs rôles, en TEXTE (comme &helpall, jamais dessiné),
 * avec trois VRAIS boutons colorés — 🔴 Supprimer / 🟢 Ajouter /
 * 🔵 Renommer — directement sous CHAQUE "Permission N", jamais groupés
 * ailleurs dans le panel ni fondus dans un menu déroulant.
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

function fakeRole(id, name, position) {
  return {
    id,
    name,
    position,
    hexColor: "#000000",
    members: { size: 0 },
    permissions: { toArray: () => [], has: () => false },
    toString() {
      return `<@&${this.id}>`;
    },
  };
}

function makeGuild() {
  return {
    id: "gtiers",
    name: "Serveur",
    ownerId: "owner-1",
    memberCount: 0,
    roles: {
      cache: new Collection([
        [ROLE_A, fakeRole(ROLE_A, "Modérateur", 2)],
        [ROLE_B, fakeRole(ROLE_B, "Support", 1)],
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

function jsonDe(guild, member, state) {
  return JSON.stringify(buildConfigPanel(guild, "roletiers", member, state).components[0].toJSON());
}

(async () => {
  console.log('Rubrique "Rôles (paliers)" — vue combinée &perms + &helpall :');

  const guild = makeGuild();
  permStore.setRoleGrants("gtiers", ROLE_A, ["moderation.kick", "moderation.ban"]);
  permStore.setRoleGrants("gtiers", ROLE_B, ["moderation.kick"]);
  permStore.setRoleExclusive("gtiers", ROLE_B, false);

  await cas("visible avec panel.permissions.manage, absente sinon", () => {
    const owner = mkMember("owner-1", null);
    const spec = buildSectionSpec(guild, "roletiers", owner, {});
    assert.ok(spec, "la rubrique doit se construire pour le propriétaire");
  });

  await cas("en TEXTE (pas en image, comme &helpall) : une ligne par palier, mentions Discord réelles", () => {
    const owner = mkMember("owner-1", null);
    const texte = jsonDe(guild, owner, {});
    assert.ok(!texte.includes("media_gallery"), "roletiers ne doit plus être dessiné en image");
    assert.ok(texte.includes("Permission 1"), texte);
    assert.ok(texte.includes(`<@&${ROLE_B}>`), "le palier à 1 permission (Support) doit apparaître, en mention brute (vrai texte Discord)");
    assert.ok(texte.includes("Permission 2"), texte);
    assert.ok(texte.includes(`<@&${ROLE_A}>`), "le palier à 2 permissions (Modérateur) doit aussi apparaître");
  });

  await cas("aucune permission accordée nulle part : message clair, pas une page vide", () => {
    const guildVide = makeGuild();
    guildVide.id = "gvide";
    const owner = mkMember("owner-1", null);
    owner.guild = { id: "gvide", ownerId: "owner-1" };
    const texte = texteDe(guildVide, owner, {});
    assert.ok(texte.includes("Aucune permission"), texte);
  });

  console.log("\nTrois boutons colorés, directement sous CHAQUE palier (pas groupés en bas, pas fondus dans un menu) :");

  await cas("chaque Permission N a SES PROPRES boutons 🔴 Supprimer / 🟢 Ajouter / 🔵 Renommer, juste en dessous de sa ligne", () => {
    const owner = mkMember("owner-1", null);
    const brut = buildConfigPanel(guild, "roletiers", owner, {}).components[0].toJSON();
    const composants = brut.components;

    const iLigne1 = composants.findIndex((c) => c.content?.includes("Permission 1"));
    const iBoutons1 = iLigne1 + 1;
    assert.ok(iLigne1 >= 0, "ligne Permission 1 introuvable");
    const rangee1 = composants[iBoutons1];
    assert.strictEqual(rangee1?.type, 1, "la ligne Permission 1 doit être IMMÉDIATEMENT suivie d'une rangée de boutons");
    assert.strictEqual(rangee1.components.length, 3, "exactement 3 boutons : Supprimer/Ajouter/Renommer");
    const [supp, ajout, ren] = rangee1.components;
    assert.strictEqual(supp.custom_id, `${ID}:tierbtn:del:t-1`);
    assert.strictEqual(supp.style, 4, "Supprimer doit être ROUGE (Danger)");
    assert.strictEqual(supp.emoji?.name, "🔴");
    assert.strictEqual(ajout.custom_id, `${ID}:tierbtn:add:t-1`);
    assert.strictEqual(ajout.style, 3, "Ajouter doit être VERT (Success)");
    assert.strictEqual(ajout.emoji?.name, "🟢");
    assert.strictEqual(ren.custom_id, `${ID}:tierbtn:ren:t-1`);
    assert.strictEqual(ren.style, 1, "Renommer doit être BLEU (Primary — le seul « bleu » Discord propose)");
    assert.strictEqual(ren.emoji?.name, "🔵");

    const iLigne2 = composants.findIndex((c) => c.content?.includes("Permission 2"));
    assert.ok(iLigne2 > iBoutons1, "Permission 2 doit venir APRÈS les boutons de Permission 1 (pas tout groupé ailleurs)");
    assert.strictEqual(composants[iLigne2 + 1]?.components?.[0]?.custom_id, `${ID}:tierbtn:del:t-2`);
  });

  await cas("aucun menu déroulant \"Choisir une action\" ne fond les boutons ensemble sur cette rubrique", () => {
    const owner = mkMember("owner-1", null);
    const texte = jsonDe(guild, owner, {});
    assert.ok(!texte.includes("Choisir une action"), "la règle générale de fusion des boutons ne doit PAS s'appliquer ici — demande explicite");
  });

  await cas("cette rubrique EXIGE panel.permissions.manage pour être visible — pas d'accès en lecture seule via panel.roles.manage", () => {
    // Contrairement à "Rôles et permissions", "Rôles (paliers)" n'a pas de
    // palier de lecture seule : sans panel.permissions.manage, buildConfigPanel
    // retombe sur une autre rubrique par défaut, donc ce n'est pas la peine
    // de tester "boutons cachés mais texte visible" ici — ce cas n'existe pas.
    permStore.grantToUser("gtiers", "u-lecture-seule", "panel.roles.manage");
    const sansDroit = mkMember("u-lecture-seule", null);
    const payload = buildConfigPanel(guild, "roletiers", sansDroit, {});
    const texte = JSON.stringify(payload.components[0].toJSON());
    assert.ok(!texte.includes("Permission 1"), "sans panel.permissions.manage, cette rubrique n'est pas accessible du tout");
  });

  console.log('\nBouton "Nettoyer les rôles supprimés" (pas lié à un palier précis) :');

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

  console.log('\n"Ajouter" (palier -> rôle choisi via un sélecteur qui apparaît juste sous CE palier) :');

  const ROLE_C = "333333333333333333";
  guild.roles.cache.set(ROLE_C, fakeRole(ROLE_C, "Nouveau Rôle", 3));

  await cas('cliquer "Ajouter" sur Permission 1 fait apparaître un sélecteur de rôle SOUS Permission 1', async () => {
    const owner = mkMember("owner-1", null);
    let updated = null;
    await handleConfigInteraction({
      customId: `${ID}:tierbtn:add:t-1`,
      member: owner,
      guild,
      client: {},
      update: async (p) => (updated = p),
    });
    const composants = updated.components[0].toJSON().components;
    const iLigne1 = composants.findIndex((c) => c.content?.includes("Permission 1"));
    // ligne -> boutons -> sélecteur d'ajout, dans cet ordre, avant Permission 2.
    const iSelecteur = composants.findIndex((c) => c.components?.[0]?.custom_id === `${ID}:tieraddrole:t-1`);
    assert.ok(iSelecteur > iLigne1, "le sélecteur doit apparaître après la ligne Permission 1");
    const iLigne2 = composants.findIndex((c) => c.content?.includes("Permission 2"));
    assert.ok(iSelecteur < iLigne2, "le sélecteur doit rester SOUS Permission 1, pas tomber après Permission 2");
  });

  await cas('choisir un rôle dans ce sélecteur copie les clés du palier sur le rôle', async () => {
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
    assert.ok(updated, "le panneau doit être mis à jour en place, immédiatement");
  });

  console.log("\nRenommer/Supprimer — un seul rôle sur le palier : action DIRECTE, pas de détour :");

  await cas('"Renommer" agit direct (modale pré-remplie) quand le palier n\'a qu\'un rôle', async () => {
    // Permission 2 (Modérateur seul) : pas d'ambiguïté possible.
    const owner = mkMember("owner-1", null);
    let modale = null;
    await handleConfigInteraction({
      customId: `${ID}:tierbtn:ren:t-2`,
      member: owner,
      guild,
      client: {},
      isModalSubmit: () => false,
      showModal: async (m) => (modale = m),
    });
    assert.ok(modale, "une modale doit s'ouvrir directement, sans étape intermédiaire");
    const champ = modale.toJSON().components[0].components[0];
    assert.strictEqual(champ.value, "Modérateur");
  });

  await cas('"Supprimer" agit direct (confirmation) quand le palier n\'a qu\'un rôle', async () => {
    // La confirmation (utils/serverAdminCommands.js::requestConfirmation) se
    // dessine en image (le titre n'est donc pas dans le JSON) : on vérifie le
    // bouton "srv:confirm:go:<token>" plutôt que du texte.
    const owner = mkMember("owner-1", null);
    let updated = null;
    await handleConfigInteraction({
      customId: `${ID}:tierbtn:del:t-2`,
      member: owner,
      guild,
      client: {},
      user: owner.user,
      update: async (p) => (updated = p),
    });
    assert.ok(JSON.stringify(updated).includes("srv:confirm:go:"), `doit demander confirmation avant de supprimer réellement : ${JSON.stringify(updated)}`);
  });

  console.log("\nRenommer/Supprimer — plusieurs rôles sur le palier : un choix s'impose d'abord :");

  await cas("Permission 1 a maintenant 2 rôles (Support + Nouveau Rôle) après l'ajout plus haut", () => {
    const tiers = require("../utils/permsCommands").computeTiers("gtiers");
    const p1 = tiers.find((t) => t.index === 1);
    assert.strictEqual(p1.roleIds.length, 2);
  });

  await cas('"Renommer" sur un palier ambigu fait apparaître un sélecteur (pas de modale directe)', async () => {
    const owner = mkMember("owner-1", null);
    let updated = null;
    let modale = null;
    await handleConfigInteraction({
      customId: `${ID}:tierbtn:ren:t-1`,
      member: owner,
      guild,
      client: {},
      isModalSubmit: () => false,
      showModal: async (m) => (modale = m),
      update: async (p) => (updated = p),
    });
    assert.ok(!modale, "pas de modale tant que le rôle précis n'est pas choisi");
    const texte = JSON.stringify(updated.components[0].toJSON());
    assert.ok(texte.includes(`${ID}:tierbtnpick:ren:t-1`), texte);
  });

  await cas("choisir un rôle précis dans ce sélecteur ouvre ENFIN la modale, pour CE rôle", async () => {
    const owner = mkMember("owner-1", null);
    let modale = null;
    await handleConfigInteraction({
      customId: `${ID}:tierbtnpick:ren:t-1`,
      values: [ROLE_C],
      member: owner,
      guild,
      client: {},
      isModalSubmit: () => false,
      showModal: async (m) => (modale = m),
    });
    assert.ok(modale, "la modale doit s'ouvrir");
    assert.strictEqual(modale.toJSON().custom_id, `${ID}:renamerole:${ROLE_C}`);
  });

  await cas('"Supprimer" sur un palier ambigu propose aussi le sélecteur, puis la confirmation pour le rôle choisi', async () => {
    const owner = mkMember("owner-1", null);
    let updated = null;
    await handleConfigInteraction({
      customId: `${ID}:tierbtn:del:t-1`,
      member: owner,
      guild,
      client: {},
      update: async (p) => (updated = p),
    });
    assert.ok(JSON.stringify(updated).includes(`${ID}:tierbtnpick:del:t-1`));

    updated = null;
    await handleConfigInteraction({
      customId: `${ID}:tierbtnpick:del:t-1`,
      values: [ROLE_C],
      member: owner,
      guild,
      client: {},
      user: owner.user,
      update: async (p) => (updated = p),
    });
    assert.ok(JSON.stringify(updated).includes("srv:confirm:go:"), JSON.stringify(updated));
  });

  console.log("\nGarde-fous de permission :");

  await cas("sans panel.permissions.manage, tierbtn/tierbtnpick/tieraddrole sont tous refusés", async () => {
    permStore.grantToUser("gtiers", "u-sans-gestion", "panel.roles.manage"); // juste assez pour VOIR le panel
    const sansDroit = mkMember("u-sans-gestion", null);
    for (const customId of [`${ID}:tierbtn:add:t-1`, `${ID}:tierbtnpick:ren:t-1`, `${ID}:tieraddrole:t-1`]) {
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

  await cas("avec panel.permissions.manage mais SANS server.roles.manage, Renommer/Supprimer restent refusés (Ajouter reste permis)", async () => {
    permStore.grantToUser("gtiers", "u-perm-seule", "panel.permissions.manage");
    const permSeule = mkMember("u-perm-seule", null);

    let refused = null;
    await handleConfigInteraction({
      customId: `${ID}:tierbtn:ren:t-2`,
      member: permSeule,
      guild,
      client: {},
      isModalSubmit: () => false,
      showModal: async () => {
        throw new Error("la modale ne doit jamais s'ouvrir sans server.roles.manage");
      },
      reply: async (p) => (refused = p),
    });
    assert.ok(refused?.content?.includes("pas la permission"), JSON.stringify(refused));

    let updated = null;
    await handleConfigInteraction({
      customId: `${ID}:tierbtn:add:t-2`,
      member: permSeule,
      guild,
      client: {},
      update: async (p) => (updated = p),
    });
    assert.ok(updated, "Ajouter ne demande que panel.permissions.manage, pas server.roles.manage");
  });

  console.log("\nGroupes exclusifs (hors hiérarchie) — même traitement :");

  await cas('un groupe exclusif a aussi ses 3 boutons, et "Ajouter" copie clés ET étiquette', async () => {
    const ROLE_EXCL = "444444444444444444";
    guild.roles.cache.set(ROLE_EXCL, fakeRole(ROLE_EXCL, "Syndicat", 4));
    permStore.setRoleGrants("gtiers", ROLE_EXCL, ["server.roles.manage"]);
    permStore.setRoleExclusive("gtiers", ROLE_EXCL, true, "Syndicat");

    const owner = mkMember("owner-1", null);
    const texte = jsonDe(guild, owner, {});
    assert.ok(texte.includes(`${ID}:tierbtn:add:e-Syndicat`), "le groupe exclusif doit avoir ses propres boutons");

    const ROLE_EXCL2 = "555555555555555555";
    guild.roles.cache.set(ROLE_EXCL2, fakeRole(ROLE_EXCL2, "Second Syndicat", 5));
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

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
