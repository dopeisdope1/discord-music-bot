/**
 * Quarantaine Admin (protection personnelle, "!!panel",
 * utils/personalProtection.js) — c'est la CIBLE PROTÉGÉE qui active cette
 * protection sur elle-même : si un exécuteur illégitime agit contre elle
 * (n'importe laquelle des 4 branches d'audit log), l'exécuteur se voit
 * retirer tous ses rôles pendant 1h (utils/adminQuarantineStore.js), en
 * plus de l'annulation habituelle. Ce fichier couvre les branches
 * Bannissement/Expulsion (déjà couvertes pour Rôle/Timeout dans
 * scripts/test-personal-protection.js) et le magasin lui-même.
 *
 * Lancement : node scripts/test-quarantine-admin.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "quarantine-admin-test-"));
process.env.BOT_OWNER_IDS = "";

const { Collection, PermissionsBitField, AuditLogEvent } = require("discord.js");
const personalProtection = require("../utils/personalProtection");
const store = require("../utils/personalProtectionStore");
const quarantineStore = require("../utils/adminQuarantineStore");

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
  const membersMap = new Map();
  const usersMap = new Map();
  return {
    id,
    roles: { cache: new Collection() },
    channels: { cache: new Collection() },
    members: {
      me: { permissions: new PermissionsBitField(PermissionsBitField.All) },
      fetch: async (uid) => membersMap.get(uid) || null,
      unban: async () => {},
    },
    client: { user: { id: "bot-1" }, users: { fetch: async (uid) => usersMap.get(uid) || null } },
    fetchAuditLogs: async () => ({ entries: new Collection() }),
    _membersMap: membersMap,
    _usersMap: usersMap,
  };
}

function fakeMember(guild, id, roleIds = []) {
  const membre = {
    id,
    guild: { id: guild.id },
    user: { id, bot: false, tag: `${id}#0000` },
    roles: {
      cache: new Collection(roleIds.map((r) => [r, { id: r }])),
      remove: async function (ids) {
        this._removed = ids;
      },
      add: async function (ids) {
        this._added = ids;
      },
    },
  };
  guild._membersMap.set(id, membre);
  return membre;
}

function fakeUser(guild, id, tag) {
  const utilisateur = { id, tag, bot: false, _dm: [], send: async function (c) { this._dm.push(c); return {}; } };
  guild._usersMap.set(id, utilisateur);
  return utilisateur;
}

function auditEntry({ action, targetId, executorId }) {
  return { action, targetId, executorId, changes: [], createdTimestamp: Date.now() };
}

(async () => {
  console.log("Quarantaine Admin — Anti-Bannissement (MemberBanAdd) :");

  await cas("un bannissement illégitime met aussi l'exécuteur en quarantaine", async () => {
    const guild = fakeGuild("g1");
    guild.roles.cache.set("role-x", { id: "role-x" });
    const executeur = fakeMember(guild, "mod-illegit-1", ["role-x"]);
    store.toggle("g1", "u1", "antiBan");
    store.toggle("g1", "u1", "quarantineAdmin");

    const entry = auditEntry({ action: AuditLogEvent.MemberBanAdd, targetId: "u1", executorId: "mod-illegit-1" });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.deepStrictEqual(executeur.roles._removed, ["role-x"]);
  });

  console.log("\nQuarantaine Admin — Alerte Expulsion (MemberKick) :");

  await cas("une expulsion illégitime met aussi l'exécuteur en quarantaine", async () => {
    const guild = fakeGuild("g2");
    guild.roles.cache.set("role-y", { id: "role-y" });
    const executeur = fakeMember(guild, "mod-illegit-2", ["role-y"]);
    fakeUser(guild, "u2", "u2#0000");
    store.toggle("g2", "u2", "antiKick");
    store.toggle("g2", "u2", "quarantineAdmin");

    const entry = auditEntry({ action: AuditLogEvent.MemberKick, targetId: "u2", executorId: "mod-illegit-2" });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.deepStrictEqual(executeur.roles._removed, ["role-y"]);
  });

  await cas("un exécuteur légitime (avec la permission) n'est jamais mis en quarantaine", async () => {
    const permStore = require("../utils/permissions/store");
    const guild = fakeGuild("g3");
    guild.roles.cache.set("role-z", { id: "role-z" });
    const executeur = fakeMember(guild, "mod-legit-3", ["role-z"]);
    fakeUser(guild, "u3", "u3#0000");
    permStore.grantToUser("g3", "mod-legit-3", "moderation.kick");
    store.toggle("g3", "u3", "antiKick");
    store.toggle("g3", "u3", "quarantineAdmin");

    const entry = auditEntry({ action: AuditLogEvent.MemberKick, targetId: "u3", executorId: "mod-legit-3" });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.strictEqual(executeur.roles._removed, undefined);
  });

  console.log("\nadminQuarantineStore — snapshot et restauration :");

  await cas("un exécuteur sans aucun rôle n'est jamais mis en quarantaine (rien à retirer)", async () => {
    const guild = fakeGuild("g4");
    const executeur = fakeMember(guild, "mod-sans-role-4", []);
    fakeUser(guild, "u4", "u4#0000");
    store.toggle("g4", "u4", "antiKick");
    store.toggle("g4", "u4", "quarantineAdmin");

    const entry = auditEntry({ action: AuditLogEvent.MemberKick, targetId: "u4", executorId: "mod-sans-role-4" });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.strictEqual(executeur.roles._removed, undefined);
    assert.strictEqual(quarantineStore.getExpired().some((q) => q.userId === "mod-sans-role-4"), false);
  });

  await cas("une nouvelle quarantaine du MÊME exécuteur remplace l'ancienne (pas d'accumulation)", () => {
    quarantineStore.add("g5", "mod-5", ["role-a"], Date.now() - 1000);
    quarantineStore.add("g5", "mod-5", ["role-b", "role-c"], Date.now() - 1000);
    const expirees = quarantineStore.getExpired().filter((q) => q.guildId === "g5" && q.userId === "mod-5");
    assert.strictEqual(expirees.length, 1);
    assert.deepStrictEqual(expirees[0].roleIds, ["role-b", "role-c"]);
  });

  await cas("checkExpiredQuarantines ne restaure que les rôles ENCORE valides sur le serveur", async () => {
    const guild = fakeGuild("g6");
    guild.roles.cache.set("role-encore-valide", { id: "role-encore-valide" });
    // "role-supprime-depuis" n'existe plus dans guild.roles.cache
    const executeur = fakeMember(guild, "mod-6", []);
    quarantineStore.add("g6", "mod-6", ["role-encore-valide", "role-supprime-depuis"], Date.now() - 1000);
    const fakeClient = { guilds: { cache: new Collection([["g6", guild]]) } };

    await personalProtection.checkExpiredQuarantines(fakeClient);
    assert.deepStrictEqual(executeur.roles._added, ["role-encore-valide"]);
  });

  await cas("checkExpiredQuarantines retire l'entrée du magasin même si le membre est introuvable", async () => {
    const guild = fakeGuild("g7");
    // aucun membre "mod-7" enregistré : guild.members.fetch renverra null
    quarantineStore.add("g7", "mod-7", ["role-a"], Date.now() - 1000);
    const fakeClient = { guilds: { cache: new Collection([["g7", guild]]) } };

    await personalProtection.checkExpiredQuarantines(fakeClient);
    assert.strictEqual(quarantineStore.getExpired().some((q) => q.guildId === "g7" && q.userId === "mod-7"), false);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
