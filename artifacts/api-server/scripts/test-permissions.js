/**
 * Vérifie le moteur de permissions central (utils/permissions/engine.js) et
 * le nettoyage des accès obsolètes (utils/permissions/cleanup.js) — la
 * partie "révocation au départ, recalcul au retour" de la refonte
 * modération/permissions/rôles/logs/panel.
 *
 * DATA_DIR pointe vers un dossier temporaire créé pour ce process : aucune
 * donnée réelle n'est lue ni écrite.
 *
 * Lancement : node scripts/test-permissions.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Collection } = require("discord.js");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "perm-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const accessStore = require("../utils/accessStore");
const permStore = require("../utils/permissions/store");
const { can } = require("../utils/permissions/engine");
const { revokeIfGone, sweepGuild, pruneDeletedRoles } = require("../utils/permissions/cleanup");

const GUILD_ID = "guild-1";

// Collection (discord.js), pas Map : cleanup.js appelle .some() sur
// guilds.cache et engine.js itère member.roles.cache — comme en production.
function fakeGuild(memberIds = [], id = GUILD_ID) {
  return { id, ownerId: "owner-server", members: { cache: new Collection(memberIds.map((mid) => [mid, { id: mid }])) } };
}

function fakeMember({ id, guild, roleIds = [] }) {
  return { id, guild, roles: { cache: new Collection(roleIds.map((r) => [r, { id: r }])) } };
}

function fakeClient(guilds) {
  return { guilds: { cache: new Collection(guilds.map((g) => [g.id, g])) } };
}

let reussis = 0;
function cas(nom, fn) {
  try {
    fn();
    reussis++;
    console.log(`  ok — ${nom}`);
  } catch (err) {
    console.error(`  ÉCHEC — ${nom}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("Moteur de permissions :");

cas("aucune permission par défaut", () => {
  const guild = fakeGuild();
  assert.strictEqual(can(fakeMember({ id: "u1", guild }), "moderation.clear"), false);
});

cas("le propriétaire du bot a toujours accès", () => {
  const guild = fakeGuild();
  assert.strictEqual(can(fakeMember({ id: "owner-1", guild }), "moderation.ban"), true);
});

cas("le rang sys a accès à tout, sauf banall", () => {
  accessStore.add("sys", "u-sys");
  const guild = fakeGuild();
  const member = fakeMember({ id: "u-sys", guild });
  assert.strictEqual(can(member, "moderation.ban"), true);
  assert.strictEqual(can(member, "moderation.banall"), false, "banall ne s'hérite jamais du rang sys");
});

cas("un rôle avec une permission accordée donne accès, et rien d'autre", () => {
  const guild = fakeGuild();
  permStore.setRoleGrants(GUILD_ID, "role-clear", ["moderation.clear"]);
  const member = fakeMember({ id: "u2", guild, roleIds: ["role-clear"] });
  assert.strictEqual(can(member, "moderation.clear"), true);
  assert.strictEqual(can(member, "moderation.ban"), false);
});

cas("retirer le rôle retire l'accès immédiatement (pas de recalcul à faire)", () => {
  const guild = fakeGuild();
  permStore.setRoleGrants(GUILD_ID, "role-clear-2", ["moderation.clear"]);
  const withRole = fakeMember({ id: "u3", guild, roleIds: ["role-clear-2"] });
  assert.strictEqual(can(withRole, "moderation.clear"), true);
  const withoutRole = fakeMember({ id: "u3", guild, roleIds: [] });
  assert.strictEqual(can(withoutRole, "moderation.clear"), false);
});

cas("moderation.banall n'est jamais octroyable par rôle", () => {
  const guild = fakeGuild();
  permStore.setRoleGrants(GUILD_ID, "role-admin", ["moderation.banall"]);
  const member = fakeMember({ id: "u4", guild, roleIds: ["role-admin"] });
  assert.strictEqual(can(member, "moderation.banall"), false);
});

cas("server.roles.admin_grant n'est jamais octroyable par rôle (le point de sécurité le plus important)", () => {
  const guild = fakeGuild();
  permStore.setRoleGrants(GUILD_ID, "role-tries-admin", ["server.roles.admin_grant"]);
  const member = fakeMember({ id: "u4b", guild, roleIds: ["role-tries-admin"] });
  assert.strictEqual(can(member, "server.roles.admin_grant"), false, "un rôle ne doit JAMAIS donner accès à server.roles.admin_grant");
});

cas("server.roles.admin_grant reste accessible au rang sys (voulu, contrairement à banall)", () => {
  accessStore.add("sys", "u-sys-admin");
  const guild = fakeGuild();
  const member = fakeMember({ id: "u-sys-admin", guild });
  assert.strictEqual(can(member, "server.roles.admin_grant"), true);
});

cas("le propriétaire du serveur a toujours accès à banall", () => {
  const guild = fakeGuild();
  assert.strictEqual(can(fakeMember({ id: "owner-server", guild }), "moderation.banall"), true);
});

cas("le pont legacy garde l'ancienne portée salon valide pour channels.lock", () => {
  accessStore.add("salon", "u5");
  const guild = fakeGuild();
  const member = fakeMember({ id: "u5", guild });
  assert.strictEqual(can(member, "channels.lock"), true);
  assert.strictEqual(can(member, "moderation.clear"), false, "le pont ne couvre PAS moderation.clear — pouvoir différent");
});

console.log("\nNettoyage des accès obsolètes :");

cas("un membre absent de tous les serveurs perd ses octrois individuels", () => {
  const guild = fakeGuild([]);
  permStore.grantToUser(GUILD_ID, "gone-1", "moderation.ban");
  const changes = revokeIfGone(fakeClient([guild]), GUILD_ID, "gone-1");
  assert.ok(changes.length > 0);
  assert.deepStrictEqual(permStore.getUserGrants(GUILD_ID, "gone-1"), []);
});

cas("un membre encore présent sur un autre serveur du bot n'est PAS révoqué", () => {
  const guildA = fakeGuild([]);
  const guildB = fakeGuild(["still-here"], "guild-2");
  permStore.grantToUser(GUILD_ID, "still-here", "moderation.ban");
  const changes = revokeIfGone(fakeClient([guildA, guildB]), GUILD_ID, "still-here");
  assert.deepStrictEqual(changes, []);
  assert.deepStrictEqual(permStore.getUserGrants(GUILD_ID, "still-here"), ["moderation.ban"]);
});

cas("un retour recalcule l'accès sur les rôles actuels, sans rien à restaurer", () => {
  const guild = fakeGuild();
  permStore.setRoleGrants(GUILD_ID, "role-clear-3", ["moderation.clear"]);
  const left = fakeMember({ id: "u6", guild, roleIds: [] }); // parti, a perdu ses rôles
  assert.strictEqual(can(left, "moderation.clear"), false);
  const backWithRole = fakeMember({ id: "u6", guild, roleIds: ["role-clear-3"] }); // revenu, réattribué
  assert.strictEqual(can(backWithRole, "moderation.clear"), true);
});

cas("sweepGuild révoque tous les absents d'un coup, épargne les présents", () => {
  const guild = fakeGuild(["present-1"]);
  permStore.grantToUser(GUILD_ID, "present-1", "moderation.kick");
  permStore.grantToUser(GUILD_ID, "absent-1", "moderation.kick");
  const revoked = sweepGuild(fakeClient([guild]), guild);
  assert.ok(revoked.includes("absent-1"));
  assert.ok(!revoked.includes("present-1"));
});

cas("pruneDeletedRoles retire les octrois des rôles qui n'existent plus, garde ceux qui existent encore", () => {
  const roleVivant = { id: "role-vivant" };
  const guild = { id: "guild-prune", roles: { cache: new Collection([[roleVivant.id, roleVivant]]) } };
  permStore.setRoleGrants("guild-prune", "role-vivant", ["moderation.kick"]);
  permStore.setRoleGrants("guild-prune", "role-mort", ["moderation.ban"]);
  permStore.setRoleExclusive("guild-prune", "role-mort-2", true);

  const removed = pruneDeletedRoles(guild);
  assert.ok(removed.includes("role-mort"));
  assert.ok(removed.includes("role-mort-2"));
  assert.ok(!removed.includes("role-vivant"));
  assert.deepStrictEqual(permStore.getRoleGrants("guild-prune", "role-vivant"), ["moderation.kick"]);
  assert.deepStrictEqual(permStore.getRoleGrants("guild-prune", "role-mort"), []);
  assert.strictEqual(permStore.isRoleExclusive("guild-prune", "role-mort-2"), false);
});

cas("pruneDeletedRoles n'a rien à faire quand tout existe encore", () => {
  const roleVivant = { id: "role-vivant-2" };
  const guild = { id: "guild-prune-2", roles: { cache: new Collection([[roleVivant.id, roleVivant]]) } };
  permStore.setRoleGrants("guild-prune-2", "role-vivant-2", ["moderation.kick"]);
  assert.deepStrictEqual(pruneDeletedRoles(guild), []);
});

console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
