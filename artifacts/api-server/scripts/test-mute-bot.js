/**
 * Mute Bot (protection personnelle, "!!panel", utils/personalProtection.js)
 * — outil perso : tu désignes une cible ; si quelqu'un d'AUTRE que toi la
 * démute, le bot la re-mute automatiquement. Recoupement audit log (même
 * patron qu'enforceMoveProtection) — jamais estActionLegitime, la seule
 * question est "est-ce un des protecteurs qui a démuté".
 *
 * Lancement : node scripts/test-mute-bot.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mute-bot-test-"));

const { Collection, AuditLogEvent } = require("discord.js");
const personalProtection = require("../utils/personalProtection");
const store = require("../utils/personalProtectionStore");
const lists = require("../utils/personalListsStore");
const muteStore = require("../utils/muteStore");

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

function fakeGuild(id, auditEntries = []) {
  return {
    id,
    roles: { cache: new Collection() },
    fetchAuditLogs: async () => ({ entries: new Collection(auditEntries.map((e, i) => [`e${i}`, e])) }),
  };
}

function fakeMemberState(guild, id, roleIds) {
  return {
    id,
    guild,
    roles: {
      cache: new Collection(roleIds.map((r) => [r, { id: r }])),
      add: async function (role) {
        this._added = role;
      },
    },
  };
}

function auditEntry({ executorId, targetId, createdTimestamp = Date.now() }) {
  return { action: AuditLogEvent.MemberRoleUpdate, executorId, targetId, createdTimestamp };
}

(async () => {
  console.log("Mute Bot (guildMemberUpdate, disparition du rôle de mute) :");

  await cas("démuté par quelqu'un d'AUTRE que le protecteur : le rôle est réappliqué", async () => {
    const guild = fakeGuild("g1", [auditEntry({ executorId: "quelquun-1", targetId: "cible-1" })]);
    guild.roles.cache.set("role-mute", { id: "role-mute" });
    muteStore.setMuteRoleId("g1", "role-mute");
    store.toggle("g1", "protecteur-1", "muteBot");
    lists.setTarget("g1", "protecteur-1", "cible-1");

    const oldMember = fakeMemberState(guild, "cible-1", ["role-mute"]);
    const newMember = fakeMemberState(guild, "cible-1", []);
    await personalProtection.enforceMuteBot(oldMember, newMember);
    assert.deepStrictEqual(newMember.roles._added, { id: "role-mute" });
  });

  await cas("démuté par le PROTECTEUR lui-même : son choix est respecté, rien ne se passe", async () => {
    const guild = fakeGuild("g2", [auditEntry({ executorId: "protecteur-2", targetId: "cible-2" })]);
    guild.roles.cache.set("role-mute", { id: "role-mute" });
    muteStore.setMuteRoleId("g2", "role-mute");
    store.toggle("g2", "protecteur-2", "muteBot");
    lists.setTarget("g2", "protecteur-2", "cible-2");

    const oldMember = fakeMemberState(guild, "cible-2", ["role-mute"]);
    const newMember = fakeMemberState(guild, "cible-2", []);
    await personalProtection.enforceMuteBot(oldMember, newMember);
    assert.strictEqual(newMember.roles._added, undefined);
  });

  await cas("sans protecteur désigné pour cette cible : rien ne se passe", async () => {
    const guild = fakeGuild("g3", [auditEntry({ executorId: "quelquun-3", targetId: "cible-3" })]);
    guild.roles.cache.set("role-mute", { id: "role-mute" });
    muteStore.setMuteRoleId("g3", "role-mute");
    // aucune cible désignée par personne pour "cible-3"

    const oldMember = fakeMemberState(guild, "cible-3", ["role-mute"]);
    const newMember = fakeMemberState(guild, "cible-3", []);
    await personalProtection.enforceMuteBot(oldMember, newMember);
    assert.strictEqual(newMember.roles._added, undefined);
  });

  await cas("Mute Bot désactivé pour le protecteur : rien ne se passe", async () => {
    const guild = fakeGuild("g4", [auditEntry({ executorId: "quelquun-4", targetId: "cible-4" })]);
    guild.roles.cache.set("role-mute", { id: "role-mute" });
    muteStore.setMuteRoleId("g4", "role-mute");
    lists.setTarget("g4", "protecteur-4", "cible-4");
    // "muteBot" jamais activé pour protecteur-4

    const oldMember = fakeMemberState(guild, "cible-4", ["role-mute"]);
    const newMember = fakeMemberState(guild, "cible-4", []);
    await personalProtection.enforceMuteBot(oldMember, newMember);
    assert.strictEqual(newMember.roles._added, undefined);
  });

  await cas("le rôle de mute n'a pas disparu (toujours présent) : rien ne se passe", async () => {
    const guild = fakeGuild("g5");
    guild.roles.cache.set("role-mute", { id: "role-mute" });
    muteStore.setMuteRoleId("g5", "role-mute");
    store.toggle("g5", "protecteur-5", "muteBot");
    lists.setTarget("g5", "protecteur-5", "cible-5");

    const oldMember = fakeMemberState(guild, "cible-5", ["role-mute"]);
    const newMember = fakeMemberState(guild, "cible-5", ["role-mute"]); // toujours là
    await personalProtection.enforceMuteBot(oldMember, newMember);
    assert.strictEqual(newMember.roles._added, undefined);
  });

  await cas("aucun rôle de mute configuré sur ce serveur : rien ne plante, rien ne se passe", async () => {
    const guild = fakeGuild("g6");
    // muteStore.setMuteRoleId jamais appelé pour g6
    store.toggle("g6", "protecteur-6", "muteBot");
    lists.setTarget("g6", "protecteur-6", "cible-6");

    const oldMember = fakeMemberState(guild, "cible-6", []);
    const newMember = fakeMemberState(guild, "cible-6", []);
    await personalProtection.enforceMuteBot(oldMember, newMember);
    assert.strictEqual(newMember.roles._added, undefined);
  });

  await cas("sans trace d'audit (recoupement impossible) mais un protecteur existe : le rôle est réappliqué quand même", async () => {
    const guild = fakeGuild("g7"); // aucune entrée d'audit
    guild.roles.cache.set("role-mute", { id: "role-mute" });
    muteStore.setMuteRoleId("g7", "role-mute");
    store.toggle("g7", "protecteur-7", "muteBot");
    lists.setTarget("g7", "protecteur-7", "cible-7");

    const oldMember = fakeMemberState(guild, "cible-7", ["role-mute"]);
    const newMember = fakeMemberState(guild, "cible-7", []);
    await personalProtection.enforceMuteBot(oldMember, newMember);
    assert.deepStrictEqual(newMember.roles._added, { id: "role-mute" });
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
