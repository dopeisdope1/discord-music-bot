/**
 * "&sys <@membre|id>" / "&unsys <@membre|id>" (utils/serverAdminCommands.js)
 * — raccourci direct vers l'ajout/retrait du rang sys, sans passer par la
 * carte "&owners". Mêmes garde-fous que le reste du rang sys
 * (utils/accessStore.js) : réservé au PROPRIÉTAIRE du bot, jamais au rang
 * sys lui-même.
 *
 * Lancement : node scripts/test-sys-unsys.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sys-unsys-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const serverAdmin = require("../utils/serverAdminCommands");
const accessStore = require("../utils/accessStore");

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

function fakeMessage(authorId, content) {
  const replies = [];
  return {
    author: { id: authorId },
    content,
    guild: { id: "g1" },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

const texteDe = (p) => (p.embeds?.[0]?.toJSON ? p.embeds[0].toJSON().description : p.embeds?.[0]?.data?.description || "");

(async () => {
  console.log('"&sys" — réservé au propriétaire :');

  await cas("un non-propriétaire ne peut rien ajouter, silence total", async () => {
    const msg = fakeMessage("intrus-1", `&sys <@${TARGET}>`);
    await serverAdmin.sysAdd(null, msg, [`<@${TARGET}>`]);
    assert.strictEqual(msg._replies.length, 0);
    assert.strictEqual(accessStore.isSys(TARGET), false);
  });

  await cas("le propriétaire ajoute réellement le rang sys", async () => {
    const msg = fakeMessage("owner-1", `&sys <@${TARGET}>`);
    await serverAdmin.sysAdd(null, msg, [`<@${TARGET}>`]);
    assert.strictEqual(accessStore.isSys(TARGET), true);
    assert.strictEqual(msg._replies.length, 1);
  });

  await cas("ajouter une deuxième fois le dit, ne casse rien", async () => {
    const msg = fakeMessage("owner-1", `&sys <@${TARGET}>`);
    await serverAdmin.sysAdd(null, msg, [`<@${TARGET}>`]);
    assert.ok(texteDe(msg._replies[0]).includes("déjà"), texteDe(msg._replies[0]));
  });

  await cas("sans argument valide, explique quoi taper, n'ajoute rien", async () => {
    accessStore.remove("sys", TARGET);
    const msg = fakeMessage("owner-1", "&sys");
    await serverAdmin.sysAdd(null, msg, []);
    assert.strictEqual(accessStore.isSys(TARGET), false);
    assert.ok(msg._replies.length === 1);
  });

  await cas("le rang sys lui-même ne peut pas en accorder à un autre", async () => {
    accessStore.add("sys", "sys-1");
    const msg = fakeMessage("sys-1", `&sys <@${TARGET}>`);
    await serverAdmin.sysAdd(null, msg, [`<@${TARGET}>`]);
    assert.strictEqual(accessStore.isSys(TARGET), false);
    accessStore.remove("sys", "sys-1");
  });

  console.log('\n"&unsys" :');

  await cas("le propriétaire retire réellement le rang sys", async () => {
    accessStore.add("sys", TARGET);
    const msg = fakeMessage("owner-1", `&unsys <@${TARGET}>`);
    await serverAdmin.sysRemove(null, msg, [`<@${TARGET}>`]);
    assert.strictEqual(accessStore.isSys(TARGET), false);
  });

  await cas("retirer quelqu'un qui n'a pas le rang le dit clairement", async () => {
    const msg = fakeMessage("owner-1", `&unsys <@${TARGET}>`);
    await serverAdmin.sysRemove(null, msg, [`<@${TARGET}>`]);
    assert.ok(texteDe(msg._replies[0]).includes("n'a pas"), texteDe(msg._replies[0]));
  });

  await cas("un non-propriétaire ne peut rien retirer, silence total", async () => {
    accessStore.add("sys", TARGET);
    const msg = fakeMessage("intrus-1", `&unsys <@${TARGET}>`);
    await serverAdmin.sysRemove(null, msg, [`<@${TARGET}>`]);
    assert.strictEqual(msg._replies.length, 0);
    assert.strictEqual(accessStore.isSys(TARGET), true);
    accessStore.remove("sys", TARGET);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
