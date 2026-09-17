/**
 * Vérifie "&zinkiller"/"&unzinkiller"/"&zinkillerlist" (utils/
 * zinkillerCommands.js, utils/zinkillerStore.js) : ban PERSISTANT, re-banni
 * automatiquement si débanni ailleurs que par "&unzinkiller" (voir
 * l'écouteur guildBanRemove dans index.js). Distinct de &ban/&unban
 * (utils/banPanel.js), un bannissement Discord ordinaire sans ce filet.
 *
 * Lancement : node scripts/test-zinkiller.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zinkiller-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { PermissionsBitField } = require("discord.js");
const zinkiller = require("../utils/zinkillerCommands");
const zinkillerStore = require("../utils/zinkillerStore");
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

const TARGET = "999888777000111222";

function fakeGuild({ hasMember = true, banFails = false, unbanFails = false, existingBan = true } = {}) {
  const banned = { value: false };
  const unbanned = { value: false };
  const targetMember = {
    id: TARGET,
    user: { id: TARGET, tag: "cible#0001" },
    roles: { highest: { position: 1 } },
  };
  return {
    id: "g1",
    ownerId: "owner-x",
    members: {
      me: { permissions: new PermissionsBitField(PermissionsBitField.All), roles: { highest: { position: 10 } } },
      fetch: async (id) => (hasMember && id === TARGET ? targetMember : null),
      ban: async (id, opts) => {
        if (banFails) throw new Error("Missing Permissions");
        banned.value = true;
        return { id, reason: opts?.reason };
      },
    },
    bans: {
      fetch: async (id) => (existingBan && id === TARGET ? { user: { id, tag: "cible#0001" } } : null),
      remove: async (id) => {
        if (unbanFails) throw new Error("Missing Permissions");
        unbanned.value = true;
      },
    },
    _banned: banned,
    _unbanned: unbanned,
  };
}

function fakeMessage(guild, authorId = "owner-1", content = "") {
  const replies = [];
  return {
    author: { id: authorId, tag: `${authorId}#0001` },
    member: { id: authorId, guild, roles: { cache: new Map(), highest: { position: 5 } }, permissions: new PermissionsBitField(PermissionsBitField.All) },
    guild,
    channel: { id: "c1" },
    content,
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

const texteDe = (p) => p.embeds?.[0]?.data?.description || p.embeds?.[0]?.toJSON?.().description || "";

(async () => {
  console.log("&zinkiller :");

  await cas("bannit réellement et enregistre le ban persistant", async () => {
    const guild = fakeGuild();
    const msg = fakeMessage(guild);
    await zinkiller.zinkiller(null, msg, [`<@${TARGET}>`, "raid"]);
    assert.strictEqual(guild._banned.value, true);
    assert.strictEqual(zinkillerStore.isZinkilled("g1", TARGET), true);
    assert.ok(texteDe(msg._replies[0]).includes("banni"), texteDe(msg._replies[0]));
  });

  await cas("fonctionne aussi par ID brut, pour un membre qui a déjà quitté", async () => {
    zinkillerStore.remove("g1", TARGET);
    const guild = fakeGuild({ hasMember: false });
    const msg = fakeMessage(guild);
    await zinkiller.zinkiller(null, msg, [TARGET]);
    assert.strictEqual(guild._banned.value, true);
    assert.strictEqual(zinkillerStore.isZinkilled("g1", TARGET), true);
  });

  await cas("sans cible valide, explique quoi taper, ne bannit rien", async () => {
    zinkillerStore.remove("g1", TARGET);
    const guild = fakeGuild();
    const msg = fakeMessage(guild);
    await zinkiller.zinkiller(null, msg, []);
    assert.strictEqual(guild._banned.value, false);
  });

  await cas("un échec Discord n'enregistre PAS le ban persistant", async () => {
    const guild = fakeGuild({ banFails: true });
    const msg = fakeMessage(guild);
    await zinkiller.zinkiller(null, msg, [TARGET]);
    assert.strictEqual(zinkillerStore.isZinkilled("g1", TARGET), false);
    assert.ok(texteDe(msg._replies[0]).includes("refusé"), texteDe(msg._replies[0]));
  });

  await cas("sans la permission moderation.zinkiller, reste muet", async () => {
    const guild = fakeGuild();
    const msg = fakeMessage(guild, "quidam-1");
    await zinkiller.zinkiller(null, msg, [TARGET]);
    assert.strictEqual(msg._replies.length, 0);
    assert.strictEqual(guild._banned.value, false);
  });

  await cas("un rôle accordé via permStore débloque aussi la commande", async () => {
    permStore.setRoleGrants("g1", "role-mod", ["moderation.zinkiller"]);
    const guild = fakeGuild();
    const msg = fakeMessage(guild, "membre-role");
    msg.member.roles.cache.set("role-mod", { id: "role-mod" });
    await zinkiller.zinkiller(null, msg, [TARGET]);
    assert.strictEqual(guild._banned.value, true);
    zinkillerStore.remove("g1", TARGET);
  });

  console.log("\n&unzinkiller :");

  await cas("débannit réellement et retire le ban persistant", async () => {
    zinkillerStore.add("g1", TARGET, { reason: "raid", moderatorId: "owner-1" });
    const guild = fakeGuild();
    const msg = fakeMessage(guild);
    await zinkiller.unzinkiller(null, msg, [TARGET]);
    assert.strictEqual(guild._unbanned.value, true);
    assert.strictEqual(zinkillerStore.isZinkilled("g1", TARGET), false);
  });

  await cas("identifiant absent de la liste des bannis : le dit, ne fait rien", async () => {
    const guild = fakeGuild({ existingBan: false });
    const msg = fakeMessage(guild);
    await zinkiller.unzinkiller(null, msg, [TARGET]);
    assert.strictEqual(guild._unbanned.value, false);
    assert.ok(texteDe(msg._replies[0]).includes("identifiant"), texteDe(msg._replies[0]));
  });

  await cas("un échec Discord restaure le ban persistant (rien n'est perdu)", async () => {
    zinkillerStore.add("g1", TARGET, { reason: "raid", moderatorId: "owner-1" });
    const guild = fakeGuild({ unbanFails: true });
    const msg = fakeMessage(guild);
    await zinkiller.unzinkiller(null, msg, [TARGET]);
    assert.strictEqual(zinkillerStore.isZinkilled("g1", TARGET), true, "l'entrée doit être restaurée après l'échec");
    zinkillerStore.remove("g1", TARGET);
  });

  await cas("sans la permission, reste muet", async () => {
    zinkillerStore.add("g1", TARGET, { reason: "raid", moderatorId: "owner-1" });
    const guild = fakeGuild();
    const msg = fakeMessage(guild, "quidam-1");
    await zinkiller.unzinkiller(null, msg, [TARGET]);
    assert.strictEqual(guild._unbanned.value, false);
    assert.strictEqual(zinkillerStore.isZinkilled("g1", TARGET), true);
    zinkillerStore.remove("g1", TARGET);
  });

  console.log("\n&zinkillerlist :");

  await cas("liste bien les bans persistants actifs", async () => {
    zinkillerStore.add("g1", TARGET, { reason: "raid", moderatorId: "owner-1" });
    const guild = fakeGuild();
    const msg = fakeMessage(guild);
    await zinkiller.zinkillerlist(null, msg);
    assert.ok(texteDe(msg._replies[0]).includes(TARGET), texteDe(msg._replies[0]));
    zinkillerStore.remove("g1", TARGET);
  });

  await cas("aucun ban persistant : le dit clairement", async () => {
    const guild = fakeGuild();
    const msg = fakeMessage(guild);
    await zinkiller.zinkillerlist(null, msg);
    assert.ok(texteDe(msg._replies[0]).includes("Aucun"), texteDe(msg._replies[0]));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
