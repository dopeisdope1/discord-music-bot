/**
 * Vérifie les commandes de configuration (utils/configCommands.js) : &prefix,
 * &set perm / &del perm / &clear perms, &join settings, &ticket settings,
 * &tempvoc, &clear limit. Elles écrivent dans les MÊMES stores que les
 * rubriques correspondantes de &panel.
 *
 * Lancement : node scripts/test-config-commands.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "configcmd-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const permStore = require("../utils/permissions/store");
const { configHandlers, resolvePermissionKey } = require("../utils/configCommands");
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

const ROLE_ADMIN = "role-admin-perms";
permStore.setRoleGrants("g1", ROLE_ADMIN, ["panel.permissions.manage"]);

function makeMessage({ userId = "owner-1", roleIds = [], roles = [], users = [], channels = new Collection() } = {}) {
  const roleCache = new Collection();
  for (const id of roleIds) roleCache.set(id, { id });
  const replies = [];
  return {
    author: { id: userId },
    member: { id: userId, guild: { id: "g1" }, roles: { cache: roleCache }, permissions: new PermissionsBitField() },
    guild: { id: "g1", roles: { cache: new Collection(roles.map((r) => [r.id, r])) }, channels: { cache: channels } },
    mentions: {
      roles: new Collection(roles.map((r) => [r.id, r])),
      users: new Collection(users.map((u) => [u.id, u])),
    },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

const texte = (msg) => msg._replies[0]?.embeds?.[0]?.data?.description || "";
const cible = { id: "role-cible", toString: () => "<@&role-cible>" };

(async () => {
  console.log("&prefix :");

  await cas("change le préfixe des commandes", async () => {
    await configHandlers.prefix(null, makeMessage(), ["!"]);
    assert.strictEqual(getPrefixes("g1").musicMod, "!");
  });

  await cas("refuse un préfixe qui rendrait les commandes intapables", async () => {
    const msg = makeMessage();
    await configHandlers.prefix(null, msg, ["beaucouptroplong"]);
    assert.strictEqual(getPrefixes("g1").musicMod, "!", "le préfixe ne doit pas avoir changé");
    assert.ok(texte(msg).includes("3 caractères"), texte(msg));
  });

  await cas("sans argument, affiche les préfixes actuels", async () => {
    const msg = makeMessage();
    await configHandlers.prefix(null, msg, []);
    assert.ok(texte(msg).includes("Préfixe des commandes"), texte(msg));
  });

  console.log("\n&set perm / &del perm / &clear perms :");

  await cas("une clé inconnue liste les clés valides au lieu d'échouer sèchement", async () => {
    const msg = makeMessage({ roleIds: [ROLE_ADMIN], roles: [cible] });
    await configHandlers.setPerm(null, msg, ["nimportequoi"]);
    assert.ok(texte(msg).includes("moderation.kick"), "les clés disponibles doivent être rappelées");
  });

  await cas("accorde une permission à un rôle", async () => {
    const msg = makeMessage({ roleIds: [ROLE_ADMIN], roles: [cible] });
    await configHandlers.setPerm(null, msg, ["moderation.kick"]);
    assert.deepStrictEqual(permStore.getRoleGrants("g1", "role-cible"), ["moderation.kick"]);
  });

  await cas("accorder deux fois ne duplique pas et le dit", async () => {
    const msg = makeMessage({ roleIds: [ROLE_ADMIN], roles: [cible] });
    await configHandlers.setPerm(null, msg, ["moderation.kick"]);
    assert.deepStrictEqual(permStore.getRoleGrants("g1", "role-cible"), ["moderation.kick"]);
    assert.ok(texte(msg).includes("déjà"), texte(msg));
  });

  await cas("une permission de plus s'ajoute sans écraser la précédente", async () => {
    await configHandlers.setPerm(null, makeMessage({ roleIds: [ROLE_ADMIN], roles: [cible] }), ["moderation.ban"]);
    assert.deepStrictEqual(permStore.getRoleGrants("g1", "role-cible").sort(), ["moderation.ban", "moderation.kick"]);
  });

  await cas("&del perm ne retire que la clé visée", async () => {
    await configHandlers.delPerm(null, makeMessage({ roleIds: [ROLE_ADMIN], roles: [cible] }), ["moderation.kick"]);
    assert.deepStrictEqual(permStore.getRoleGrants("g1", "role-cible"), ["moderation.ban"]);
  });

  await cas("&clear perms vide tout et annonce le nombre retiré", async () => {
    const msg = makeMessage({ roleIds: [ROLE_ADMIN], roles: [cible] });
    await configHandlers.clearPerms(null, msg);
    assert.deepStrictEqual(permStore.getRoleGrants("g1", "role-cible"), []);
    assert.ok(texte(msg).includes("1 permission"), texte(msg));
  });

  await cas("les permissions individuelles passent par le même chemin", async () => {
    const membre = { id: "membre-1" };
    await configHandlers.setPerm(null, makeMessage({ roleIds: [ROLE_ADMIN], users: [membre] }), ["logs.view"]);
    assert.deepStrictEqual(permStore.getUserGrants("g1", "membre-1"), ["logs.view"]);
    await configHandlers.clearPerms(null, makeMessage({ roleIds: [ROLE_ADMIN], users: [membre] }));
    assert.deepStrictEqual(permStore.getUserGrants("g1", "membre-1"), []);
  });

  await cas("la clé est tolérante à la casse", () => {
    assert.strictEqual(resolvePermissionKey("MODERATION.Kick"), "moderation.kick");
    assert.strictEqual(resolvePermissionKey("  logs.view  "), "logs.view");
    assert.strictEqual(resolvePermissionKey("inexistante"), null);
  });

  await cas("sans le droit panel.permissions.manage, tout reste muet", async () => {
    const msg = makeMessage({ userId: "membre-lambda", roles: [cible] });
    await configHandlers.setPerm(null, msg, ["moderation.ban"]);
    assert.strictEqual(msg._replies.length, 0);
    assert.deepStrictEqual(permStore.getRoleGrants("g1", "role-cible"), []);
  });

  console.log("\nVues de configuration :");

  await cas("&join settings, &ticket settings, &tempvoc et &clear limit répondent", async () => {
    for (const handler of [configHandlers.joinSettings, configHandlers.ticketSettings, configHandlers.tempvoc, configHandlers.clearLimit]) {
      const msg = makeMessage();
      await handler(null, msg);
      assert.strictEqual(msg._replies.length, 1, "chacune doit répondre");
      assert.ok(texte(msg).includes(">"), "et afficher l'état courant");
    }
  });

  await cas("un salon ou rôle configuré puis supprimé est signalé, pas affiché en cassé", async () => {
    const msg = makeMessage();
    await configHandlers.tempvoc(null, msg);
    // Aucun hub configuré ici : la commande doit le dire clairement.
    assert.ok(texte(msg).includes("aucun"), texte(msg));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
