/**
 * Vérifie "&p" (utils/palierPanel.js) : raccourci direct vers les paliers de
 * permissions, sans passer par &panel (accueil -> menu -> sous-menu), qui
 * était devenu incompréhensible à force d'options (pagination, palier
 * "ouvert" qui remplace toute la liste, nommer un palier, nettoyer,
 * provisionnement en masse...). Celui-ci ne fait qu'UNE chose : une ligne
 * par palier avec Supprimer/Ajouter/Renommer juste dessous.
 *
 * Fichier volontairement indépendant de la machine à états d'&panel — mêmes
 * garde-fous à revérifier ici : pas de custom_id en double (voir le bug
 * corrigé dans &panel, scripts/test-panel-role-tiers.js), permissions
 * correctement séparées (panel.permissions.manage pour voir/ajouter,
 * server.roles.manage en plus pour renommer/supprimer).
 *
 * Lancement : node scripts/test-palier-panel.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "palier-panel-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const palierPanel = require("../utils/palierPanel");
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

const ROLE_A = "111111111111111111"; // Modérateur — 2 clés
const ROLE_B = "222222222222222222"; // Support — 1 clé
const ROLE_C = "333333333333333333"; // sans grant au départ

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
    id: "gpalier",
    name: "Serveur",
    ownerId: "owner-1",
    roles: {
      cache: new Collection([
        [ROLE_A, fakeRole(ROLE_A, "Modérateur", 2)],
        [ROLE_B, fakeRole(ROLE_B, "Support", 1)],
        [ROLE_C, fakeRole(ROLE_C, "Nouveau Rôle", 3)],
      ]),
      everyone: { permissions: new PermissionsBitField([]) },
    },
    channels: { cache: new Collection() },
    members: { cache: new Collection(), me: { roles: { highest: { position: 9 } }, permissions: { has: () => true } } },
    client: { uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } },
  };
}

function mkMember(id, roleId) {
  return {
    id,
    guild: { id: "gpalier", ownerId: "owner-1" },
    roles: { cache: roleId ? new Collection([[roleId, { id: roleId }]]) : new Collection() },
    permissions: { has: () => false },
    user: { tag: `${id}#0001` },
  };
}

function jsonDe(payload) {
  return JSON.stringify(payload.components[0].toJSON());
}

function idsDe(composant, acc = []) {
  if (composant.custom_id) acc.push(composant.custom_id);
  if (composant.components) for (const sous of composant.components) idsDe(sous, acc);
  return acc;
}

function fakeMessage(authorId, guild, member) {
  const replies = [];
  return {
    author: { id: authorId },
    member,
    guild,
    channel: { id: "chan-1" },
    reply: async (p) => {
      const envoye = { id: `msg-${replies.length}`, ...p };
      replies.push(p);
      return envoye;
    },
    _replies: replies,
  };
}

(async () => {
  const guild = makeGuild();
  permStore.setRoleGrants("gpalier", ROLE_A, ["moderation.kick", "moderation.ban"]);
  permStore.setRoleGrants("gpalier", ROLE_B, ["moderation.kick"]);

  console.log('"&p" — panneau minimal :');

  await cas("public en lecture : poste le panel pour n'importe qui, même sans droit", async () => {
    const quidam = mkMember("quidam-1", null);
    const msg = fakeMessage("quidam-1", guild, quidam);
    await palierPanel.handlePalierTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 1);
    const texte = jsonDe(msg._replies[0]);
    assert.ok(texte.includes("Rôles (paliers)"));
    assert.ok(texte.includes("Permission 1") && texte.includes("Permission 2"));
  });

  await cas("aucun chrome de &panel (pas de nav, pas de sous-menu, pas de pagination)", async () => {
    const owner = mkMember("owner-1", null);
    const msg = fakeMessage("owner-1", guild, owner);
    await palierPanel.handlePalierTextCommand(null, msg);
    const texte = jsonDe(msg._replies[0]);
    assert.ok(!texte.includes("PANEL DE CONFIGURATION"));
    assert.ok(!texte.includes("cfg:nav"));
    assert.ok(!texte.includes("Page "));
  });

  await cas("sans panel.permissions.manage, le texte reste lisible mais aucun bouton n'apparaît", () => {
    const quidam = mkMember("quidam-2", null);
    const payload = palierPanel.buildPalierPanel(guild, quidam, {});
    const texte = jsonDe(payload);
    assert.ok(texte.includes("Permission 1"));
    assert.ok(!texte.includes(`${palierPanel.CUSTOM_ID}:`));
  });

  await cas("un palier à UN SEUL rôle affiche direct Supprimer(rouge)/Ajouter(vert)/Renommer(bleu)", () => {
    const owner = mkMember("owner-1", null);
    const brut = palierPanel.buildPalierPanel(guild, owner, {}).components[0].toJSON();
    const iLigne = brut.components.findIndex((c) => c.content?.includes("Permission 1"));
    const rangee = brut.components[iLigne + 1];
    assert.strictEqual(rangee.type, 1);
    const [supp, ajout, ren] = rangee.components;
    assert.strictEqual(supp.custom_id, `${palierPanel.CUSTOM_ID}:del:${ROLE_B}`);
    assert.strictEqual(supp.style, 4);
    assert.strictEqual(ajout.custom_id, `${palierPanel.CUSTOM_ID}:addopen:t-1:0`);
    assert.strictEqual(ajout.style, 3);
    assert.strictEqual(ren.custom_id, `${palierPanel.CUSTOM_ID}:ren:${ROLE_B}`);
    assert.strictEqual(ren.style, 1);
  });

  await cas("aucun custom_id en double sur le panel entier", () => {
    const owner = mkMember("owner-1", null);
    const brut = palierPanel.buildPalierPanel(guild, owner, {}).components[0].toJSON();
    const ids = brut.components.flatMap((c) => idsDe(c));
    const doublons = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    assert.deepStrictEqual(doublons, []);
  });

  console.log('\n"Ajouter" — ouvre le palier (remplace la liste, budget de composants oblige) :');

  await cas('cliquer "Ajouter" REMPLACE la liste par CE palier seul, avec son RoleSelectMenu et un retour', async () => {
    const owner = mkMember("owner-1", null);
    let updated = null;
    await palierPanel.handlePalierInteraction({
      customId: `${palierPanel.CUSTOM_ID}:addopen:t-1:0`,
      member: owner,
      guild,
      client: {},
      update: async (p) => (updated = p),
    });
    const composants = updated.components[0].toJSON().components;
    const iLigne = composants.findIndex((c) => c.content?.includes("Permission 1"));
    assert.ok(iLigne >= 0);
    assert.ok(!composants.some((c) => c.content?.includes("Permission 2")), "un palier ouvert REMPLACE la liste — sinon le budget de 40 composants explose");
    const iSelecteur = composants.findIndex((c) => c.components?.[0]?.custom_id === `${palierPanel.CUSTOM_ID}:add:t-1:0`);
    assert.ok(iSelecteur > iLigne);
    const labels = composants.filter((c) => c.type === 1).flatMap((r) => r.components).map((b) => b.label);
    assert.ok(labels.includes("◀ Retour à la liste"));
  });

  await cas("choisir un rôle dans ce sélecteur copie les clés du palier", async () => {
    assert.deepStrictEqual(permStore.getRoleGrants("gpalier", ROLE_C), []);
    const owner = mkMember("owner-1", null);
    let updated = null;
    await palierPanel.handlePalierInteraction({
      customId: `${palierPanel.CUSTOM_ID}:add:t-1:0`,
      values: [ROLE_C],
      member: owner,
      guild,
      client: {},
      update: async (p) => (updated = p),
    });
    assert.deepStrictEqual(permStore.getRoleGrants("gpalier", ROLE_C), permStore.getRoleGrants("gpalier", ROLE_B));
    assert.ok(updated);
  });

  console.log("\nPalier à plusieurs rôles (Permission 1 en a 2 maintenant) :");

  await cas('affiche "Ajouter" + "Renommer/Supprimer" (pas de bouton direct, ambigu)', () => {
    const owner = mkMember("owner-1", null);
    const brut = palierPanel.buildPalierPanel(guild, owner, {}).components[0].toJSON();
    const iLigne = brut.components.findIndex((c) => c.content?.includes("Permission 1"));
    const rangee = brut.components[iLigne + 1];
    const labels = rangee.components.map((b) => b.label);
    assert.deepStrictEqual(labels, ["Ajouter", "Renommer/Supprimer"]);
  });

  await cas('"Renommer/Supprimer" révèle deux sélecteurs (lequel renommer, lequel supprimer)', async () => {
    const owner = mkMember("owner-1", null);
    let updated = null;
    await palierPanel.handlePalierInteraction({
      customId: `${palierPanel.CUSTOM_ID}:manopen:t-1:0`,
      member: owner,
      guild,
      client: {},
      update: async (p) => (updated = p),
    });
    const texte = JSON.stringify(updated.components[0].toJSON());
    assert.ok(texte.includes(`${palierPanel.CUSTOM_ID}:renpick:t-1`));
    assert.ok(texte.includes(`${palierPanel.CUSTOM_ID}:delpick:t-1`));
  });

  await cas('choisir un rôle dans "renpick" ouvre directement sa modale de renommage', async () => {
    const owner = mkMember("owner-1", null);
    let modale = null;
    await palierPanel.handlePalierInteraction({
      customId: `${palierPanel.CUSTOM_ID}:renpick:t-1`,
      values: [ROLE_C],
      member: owner,
      guild,
      client: {},
      isModalSubmit: () => false,
      showModal: async (m) => (modale = m),
    });
    assert.ok(modale);
    assert.strictEqual(modale.toJSON().custom_id, `${palierPanel.CUSTOM_ID}:ren:${ROLE_C}`);
    assert.strictEqual(modale.toJSON().components[0].components[0].value, "Nouveau Rôle");
  });

  await cas('choisir un rôle dans "delpick" déclenche directement la confirmation de suppression', async () => {
    const owner = mkMember("owner-1", null);
    let updated = null;
    await palierPanel.handlePalierInteraction({
      customId: `${palierPanel.CUSTOM_ID}:delpick:t-1`,
      values: [ROLE_C],
      member: owner,
      guild,
      client: {},
      user: owner.user,
      update: async (p) => (updated = p),
    });
    // La confirmation (utils/serverAdminCommands.js::requestConfirmation) se
    // dessine en image : on vérifie le bouton "srv:confirm:go:<token>".
    assert.ok(JSON.stringify(updated).includes("srv:confirm:go:"), JSON.stringify(updated));
  });

  console.log("\nRenommer/Supprimer direct sur un palier à un seul rôle :");

  await cas('"Renommer" ouvre directement la modale, pré-remplie', async () => {
    const owner = mkMember("owner-1", null);
    let modale = null;
    await palierPanel.handlePalierInteraction({
      customId: `${palierPanel.CUSTOM_ID}:ren:${ROLE_B}`,
      member: owner,
      guild,
      client: {},
      isModalSubmit: () => false,
      showModal: async (m) => (modale = m),
    });
    assert.strictEqual(modale.toJSON().components[0].components[0].value, "Support");
  });

  await cas('"Supprimer" déclenche directement la confirmation', async () => {
    const owner = mkMember("owner-1", null);
    let updated = null;
    await palierPanel.handlePalierInteraction({
      customId: `${palierPanel.CUSTOM_ID}:del:${ROLE_B}`,
      member: owner,
      guild,
      client: {},
      user: owner.user,
      update: async (p) => (updated = p),
    });
    assert.ok(JSON.stringify(updated).includes("srv:confirm:go:"));
  });

  console.log("\nGarde-fous de permission :");

  await cas("sans panel.permissions.manage, toute interaction est refusée", async () => {
    const sansDroit = mkMember("u-sans", null);
    let refused = null;
    await palierPanel.handlePalierInteraction({
      customId: `${palierPanel.CUSTOM_ID}:addopen:t-1`,
      member: sansDroit,
      guild,
      client: {},
      reply: async (p) => (refused = p),
    });
    assert.ok(refused?.content?.includes("pas la permission"));
  });

  await cas("avec panel.permissions.manage mais SANS server.roles.manage : Renommer/Supprimer refusés, Ajouter permis", async () => {
    permStore.grantToUser("gpalier", "u-perm-seule", "panel.permissions.manage");
    const permSeule = mkMember("u-perm-seule", null);

    let refused = null;
    await palierPanel.handlePalierInteraction({
      customId: `${palierPanel.CUSTOM_ID}:ren:${ROLE_B}`,
      member: permSeule,
      guild,
      client: {},
      isModalSubmit: () => false,
      showModal: async () => {
        throw new Error("la modale ne doit jamais s'ouvrir sans server.roles.manage");
      },
      reply: async (p) => (refused = p),
    });
    assert.ok(refused?.content?.includes("pas la permission"));

    let updated = null;
    await palierPanel.handlePalierInteraction({
      customId: `${palierPanel.CUSTOM_ID}:addopen:t-2`,
      member: permSeule,
      guild,
      client: {},
      update: async (p) => (updated = p),
    });
    assert.ok(updated, "Ajouter ne demande que panel.permissions.manage");
  });

  console.log("\nÉtat vide :");

  await cas("aucune permission accordée nulle part : message clair, pas une page vide", () => {
    const guildVide = makeGuild();
    guildVide.id = "gvide-p";
    const owner = mkMember("owner-1", null);
    owner.guild = { id: "gvide-p", ownerId: "owner-1" };
    const texte = jsonDe(palierPanel.buildPalierPanel(guildVide, owner, {}));
    assert.ok(texte.includes("Aucune permission"));
  });

  console.log("\nBudget de 40 composants Discord — bug réel rencontré en production :");

  await cas("un serveur à 16 paliers (comme en prod) ne dépasse JAMAIS 40 composants, sur aucune page ni aucun état", () => {
    // Bug réel : le premier calcul ("un palier ne coûte que 2 composants")
    // ne comptait pas les boutons D'UNE RANGÉE comme des composants à part
    // entière — Discord, si. Un palier à un seul rôle en coûte en réalité
    // jusqu'à 5 (texte + rangée + 3 boutons). Sans pagination, un serveur à
    // 16 paliers (13 numérotés + 3 exclusifs, exactement la config
    // rencontrée en prod) envoyait déjà ~82 composants dès le premier "&p" —
    // Discord refusait le message entier, silencieusement pour qui tapait la
    // commande ("L'application n'a pas répondu"). Ce test compte les VRAIS
    // composants (boutons inclus) pour re-produire exactement ce scénario.
    const grosGuild = {
      id: "ggros",
      name: "GrosServeur",
      ownerId: "owner-1",
      roles: { cache: new Collection(), everyone: { permissions: new PermissionsBitField([]) } },
      channels: { cache: new Collection() },
      members: { cache: new Collection(), me: { roles: { highest: { position: 99 } }, permissions: { has: () => true } } },
      client: { uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } },
    };
    // 16 rôles, chacun avec un ensemble de clés STRICTEMENT différent (donc
    // 16 paliers numérotés distincts, tous à un seul rôle — le pire cas pour
    // le coût en composants, 5 chacun).
    for (let i = 0; i < 16; i++) {
      const roleId = `9${String(i).padStart(17, "0")}`;
      grosGuild.roles.cache.set(roleId, {
        id: roleId,
        name: `Rôle ${i}`,
        position: i + 1,
        hexColor: "#000000",
        members: { size: 0 },
        permissions: { toArray: () => [], has: () => false },
        toString() {
          return `<@&${this.id}>`;
        },
      });
      permStore.setRoleGrants("ggros", roleId, Array.from({ length: i + 1 }, (_, k) => `perm${k}`));
    }
    const owner = { id: "owner-1", guild: { id: "ggros", ownerId: "owner-1" }, roles: { cache: new Collection() }, permissions: { has: () => false }, user: { tag: "owner#0001" } };

    const compter = (c) => 1 + (c.components ? c.components.reduce((s, x) => s + compter(x), 0) : 0);
    const lignes = palierPanel.lignesPaliers(grosGuild);
    assert.strictEqual(lignes.length, 16, "16 paliers attendus, comme en prod");

    const cles = lignes.map((l) => l.cle);
    for (const page of [0, 1, 2, 3]) {
      for (const ouvertKey of [null, ...cles]) {
        const json = palierPanel.buildPalierPanel(grosGuild, owner, { page, addOpenKey: ouvertKey }).components[0].toJSON();
        const total = json.components.reduce((s, c) => s + compter(c), 0);
        assert.ok(total <= 40, `page ${page} / ouvert=${ouvertKey} : ${total} composants`);
      }
    }
  });

  await cas("au-delà d'une page, le pager apparaît ; aucun custom_id en double sur aucune page", () => {
    const grosGuild = {
      id: "ggros2",
      name: "GrosServeur2",
      ownerId: "owner-1",
      roles: { cache: new Collection(), everyone: { permissions: new PermissionsBitField([]) } },
      channels: { cache: new Collection() },
      members: { cache: new Collection(), me: { roles: { highest: { position: 99 } }, permissions: { has: () => true } } },
      client: { uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } },
    };
    for (let i = 0; i < 16; i++) {
      const roleId = `8${String(i).padStart(17, "0")}`;
      grosGuild.roles.cache.set(roleId, {
        id: roleId,
        name: `Rôle ${i}`,
        position: i + 1,
        hexColor: "#000000",
        members: { size: 0 },
        permissions: { toArray: () => [], has: () => false },
        toString() {
          return `<@&${this.id}>`;
        },
      });
      permStore.setRoleGrants("ggros2", roleId, Array.from({ length: i + 1 }, (_, k) => `permB${k}`));
    }
    const owner = { id: "owner-1", guild: { id: "ggros2", ownerId: "owner-1" }, roles: { cache: new Collection() }, permissions: { has: () => false }, user: { tag: "owner#0001" } };

    const brut = palierPanel.buildPalierPanel(grosGuild, owner, {}).components[0].toJSON();
    const labels = brut.components.filter((c) => c.type === 1).flatMap((r) => r.components).map((b) => b.label);
    assert.ok(labels.some((l) => l?.startsWith("Page ")), "16 paliers doivent être paginés (6 par page)");

    for (const page of [0, 1, 2]) {
      const json = palierPanel.buildPalierPanel(grosGuild, owner, { page }).components[0].toJSON();
      const ids = json.components.flatMap((c) => idsDe(c));
      const doublons = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
      assert.deepStrictEqual(doublons, [], `page ${page} : custom_id en double : ${doublons.join(", ")}`);
    }
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
