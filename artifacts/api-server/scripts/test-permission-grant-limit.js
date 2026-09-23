/**
 * Vérifie qu'un rang sys (non owner) ne peut plus ACCORDER certaines
 * permissions sensibles ("ownerOnlyGrant" dans utils/permissions/catalog.js
 * — panel.permissions.manage, panel.access.manage), que ce soit par rôle
 * (&panel > Rôles et permissions) ou individuellement (&access, =add,
 * &owner, !!owner). L'USAGE de ces permissions par un sys qui les détient
 * déjà reste inchangé (can() n'est pas concerné) ; seule leur DISTRIBUTION
 * est restreinte. Un sys garde le droit de REVOQUER une telle permission
 * déjà accordée.
 *
 * Lancement : node scripts/test-permission-grant-limit.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "grant-limit-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const accessStore = require("../utils/accessStore");
const { can, peutAccorder } = require("../utils/permissions/engine");
const { isOwnerOnlyGrant } = require("../utils/permissions/catalog");
const permStore = require("../utils/permissions/store");
const { handleConfigInteraction } = require("../utils/configPanel");
const { handleServerAdminInteraction, ID: ADMIN_ID } = require("../utils/serverAdminCommands");

accessStore.add("sys", "sys-1");

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

function fakeGuild(id) {
  const ROLE_ID = "111111111111111111";
  return {
    id,
    name: "Serveur",
    ownerId: "owner-1",
    roles: {
      cache: new Collection([
        [ROLE_ID, { id: ROLE_ID, name: "Test", position: 1, hexColor: "#000000", members: { size: 0 }, permissions: { toArray: () => [], has: () => false }, toString() { return `<@&${this.id}>`; } }],
      ]),
      everyone: { permissions: new PermissionsBitField([]) },
    },
    channels: { cache: new Collection() },
    members: { cache: new Collection(), fetch: async (id2) => ({ id: id2, user: { tag: `${id2}#0001` } }), me: { roles: { highest: { position: 9 } }, permissions: { has: () => true } } },
    emojis: { cache: new Collection() },
    voiceStates: { cache: new Collection() },
    client: { uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } },
  };
}

const ROLE_ID = "111111111111111111";

(async () => {
  console.log("Catalogue — clés marquées ownerOnlyGrant :");

  await cas("panel.permissions.manage et panel.access.manage sont ownerOnlyGrant", () => {
    assert.ok(isOwnerOnlyGrant("panel.permissions.manage"));
    assert.ok(isOwnerOnlyGrant("panel.access.manage"));
  });

  await cas("panel.roles.manage et les permissions courantes (moderation.kick...) ne le sont PAS", () => {
    assert.ok(!isOwnerOnlyGrant("panel.roles.manage"));
    assert.ok(!isOwnerOnlyGrant("moderation.kick"));
  });

  console.log("\nutils/permissions/engine.js::peutAccorder — la fonction de bas niveau :");

  await cas("l'owner peut accorder n'importe quelle clé, y compris ownerOnlyGrant", () => {
    const owner = { id: "owner-1", guild: { id: "g1" } };
    assert.ok(peutAccorder(owner, "panel.permissions.manage"));
    assert.ok(peutAccorder(owner, "panel.access.manage"));
    assert.ok(peutAccorder(owner, "moderation.kick"));
  });

  await cas("un sys NE PEUT PAS accorder une clé ownerOnlyGrant, mais peut accorder le reste", () => {
    const sys = { id: "sys-1", guild: { id: "g1" } };
    assert.strictEqual(peutAccorder(sys, "panel.permissions.manage"), false);
    assert.strictEqual(peutAccorder(sys, "panel.access.manage"), false);
    assert.ok(peutAccorder(sys, "panel.roles.manage"));
    assert.ok(peutAccorder(sys, "moderation.kick"));
  });

  await cas("can() reste inchangé : un sys profite toujours de TOUTES les permissions, y compris ownerOnlyGrant", () => {
    const sys = { id: "sys-1", guild: { id: "g1" } };
    assert.ok(can(sys, "panel.permissions.manage"));
    assert.ok(can(sys, "panel.access.manage"));
    assert.ok(can(sys, "moderation.kick"));
  });

  console.log('\n"&panel" > Rôles et permissions — octroi PAR RÔLE :');

  await cas("un sys qui coche panel.permissions.manage voit cette clé ignorée, le reste appliqué", async () => {
    const guild = fakeGuild("gpanel1");
    const sysMember = { id: "sys-1", guild, roles: { cache: new Collection() } };
    await handleConfigInteraction({
      customId: `cfg:permkeys:${ROLE_ID}:panel`,
      values: ["panel.permissions.manage", "panel.roles.manage"],
      member: sysMember,
      guild,
      client: {},
      update: async () => {},
    });
    const granted = permStore.getRoleGrants("gpanel1", ROLE_ID);
    assert.ok(!granted.includes("panel.permissions.manage"), "panel.permissions.manage ne doit pas être accordée par un sys");
    assert.ok(granted.includes("panel.roles.manage"), "panel.roles.manage doit rester accordée normalement");
  });

  await cas("l'owner peut accorder panel.permissions.manage par rôle sans restriction", async () => {
    const guild = fakeGuild("gpanel2");
    const ownerMember = { id: "owner-1", guild, roles: { cache: new Collection() } };
    await handleConfigInteraction({
      customId: `cfg:permkeys:${ROLE_ID}:panel`,
      values: ["panel.permissions.manage", "panel.access.manage"],
      member: ownerMember,
      guild,
      client: {},
      update: async () => {},
    });
    const granted = permStore.getRoleGrants("gpanel2", ROLE_ID);
    assert.ok(granted.includes("panel.permissions.manage"));
    assert.ok(granted.includes("panel.access.manage"));
  });

  console.log('\n"&access"/"=add"/"&owner" — octroi INDIVIDUEL (une clé à la fois) :');

  await cas("un sys qui tente d'accorder panel.permissions.manage individuellement est refusé", async () => {
    const guild = fakeGuild("gaccess1");
    const sysMember = { id: "sys-1", guild, roles: { cache: new Collection() } };
    let refused = null;
    await handleServerAdminInteraction({
      customId: `${ADMIN_ID}:accesskey:target-1:panel`,
      values: ["panel.permissions.manage"],
      member: sysMember,
      guild,
      client: {},
      reply: async (p) => (refused = p),
      update: async () => {},
    });
    assert.ok(refused?.content?.includes("propriétaire"), JSON.stringify(refused));
    assert.deepStrictEqual(permStore.getUserGrants("gaccess1", "target-1"), []);
  });

  await cas("l'owner peut accorder panel.permissions.manage individuellement sans restriction", async () => {
    const guild = fakeGuild("gaccess2");
    const ownerMember = { id: "owner-1", guild, roles: { cache: new Collection() } };
    await handleServerAdminInteraction({
      customId: `${ADMIN_ID}:accesskey:target-1:panel`,
      values: ["panel.permissions.manage"],
      member: ownerMember,
      guild,
      client: {},
      reply: async () => {},
      update: async () => {},
    });
    assert.ok(permStore.getUserGrants("gaccess2", "target-1").includes("panel.permissions.manage"));
  });

  await cas("un sys peut toujours REVOQUER une clé ownerOnlyGrant déjà accordée (par un owner)", async () => {
    const guild = fakeGuild("gaccess3");
    permStore.grantToUser("gaccess3", "target-1", "panel.permissions.manage");
    const sysMember = { id: "sys-1", guild, roles: { cache: new Collection() } };
    await handleServerAdminInteraction({
      customId: `${ADMIN_ID}:accesskey:target-1:panel`,
      values: ["panel.permissions.manage"],
      member: sysMember,
      guild,
      client: {},
      reply: async () => {},
      update: async () => {},
    });
    assert.deepStrictEqual(permStore.getUserGrants("gaccess3", "target-1"), []);
  });

  await cas('"ownerkey" (carte "=add"/"&owner") applique la même restriction', async () => {
    const guild = fakeGuild("gowner1");
    const sysMember = { id: "sys-1", guild, roles: { cache: new Collection() } };
    let refused = null;
    await handleServerAdminInteraction({
      customId: `${ADMIN_ID}:ownerkey:target-1:panel`,
      values: ["panel.access.manage"],
      member: sysMember,
      guild,
      client: {},
      reply: async (p) => (refused = p),
      update: async () => {},
    });
    assert.ok(refused?.content?.includes("propriétaire"), JSON.stringify(refused));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? ", des échecs sont survenus." : ", tout est vert."}`);
})();
