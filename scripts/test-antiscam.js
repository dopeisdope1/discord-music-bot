/**
 * Vérifie l'anti-scam (utils/automod/antiScam.js) : supprime les liens de
 * phishing connus (faux-nitro, faux Steam) sans jamais bloquer les vrais
 * domaines Discord/Steam — même patron qu'utils/automod/antiLink.js
 * (scripts/test-automod.js).
 *
 * Lancement : node scripts/test-antiscam.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "antiscam-test-"));

const antiScam = require("../utils/automod/antiScam");
const { Collection } = require("discord.js");

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

function fakeMember(id, guildId = "g1") {
  return { id, guild: { id: guildId }, roles: { cache: new Collection() } };
}

function fakeMessage({ content = "", authorId = "u1", guildId = "g1", deletable = true } = {}) {
  const deleted = { value: false };
  return {
    author: { id: authorId, bot: false, tag: `${authorId}#0000` },
    member: fakeMember(authorId, guildId),
    guild: { id: guildId },
    channel: { id: "c1", toString: () => "<#c1>" },
    content,
    deletable,
    delete: async () => {
      deleted.value = true;
    },
    _deleted: deleted,
  };
}

const CLIENT = { user: { id: "bot" } };

(async () => {
  console.log("Anti-scam — configuration :");

  await cas("désactivé par défaut", () => {
    assert.strictEqual(antiScam.getConfig("g1").enabled, false);
  });

  console.log("\nAnti-scam — ne fait rien si désactivé :");

  await cas("un lien de scam évident n'est pas supprimé tant que c'est désactivé", async () => {
    const msg = fakeMessage({ content: "http://discord-nitro.com/free", guildId: "g-off" });
    await antiScam.checkMessage(CLIENT, msg);
    assert.strictEqual(msg._deleted.value, false);
  });

  console.log("\nAnti-scam — détection une fois activé :");

  await cas("faux-nitro (discord + nitro/gift sur un domaine imité) supprimé", async () => {
    antiScam.setEnabled("g-nitro", true);
    const msg = fakeMessage({ content: "http://discord-nitro.com/free", guildId: "g-nitro" });
    await antiScam.checkMessage(CLIENT, msg);
    assert.strictEqual(msg._deleted.value, true);
  });

  await cas("substitution leet (dlscord-gift) détectée aussi", async () => {
    antiScam.setEnabled("g-leet", true);
    const msg = fakeMessage({ content: "claim it at http://dlscord-gift.ru/claim", guildId: "g-leet" });
    await antiScam.checkMessage(CLIENT, msg);
    assert.strictEqual(msg._deleted.value, true);
  });

  await cas("faux Steam (steamcommunlty, une lettre en moins) supprimé", async () => {
    antiScam.setEnabled("g-steam", true);
    const msg = fakeMessage({ content: "http://steamcommunlty.com/gift", guildId: "g-steam" });
    await antiScam.checkMessage(CLIENT, msg);
    assert.strictEqual(msg._deleted.value, true);
  });

  console.log("\nAnti-scam — jamais les vrais domaines :");

  await cas("discord.com / discord.gift / discord.gg / cdn.discordapp.com jamais touchés", async () => {
    antiScam.setEnabled("g-legit1", true);
    for (const url of [
      "http://discord.com/anything",
      "http://discord.gift/abc123",
      "http://discord.gg/abcd",
      "http://cdn.discordapp.com/attachments/x",
    ]) {
      const msg = fakeMessage({ content: url, guildId: "g-legit1" });
      await antiScam.checkMessage(CLIENT, msg);
      assert.strictEqual(msg._deleted.value, false, url);
    }
  });

  await cas("steamcommunity.com (vrai domaine) jamais touché", async () => {
    antiScam.setEnabled("g-legit2", true);
    const msg = fakeMessage({ content: "http://steamcommunity.com/trade/offer", guildId: "g-legit2" });
    await antiScam.checkMessage(CLIENT, msg);
    assert.strictEqual(msg._deleted.value, false);
  });

  await cas("un message sans lien n'est jamais touché", async () => {
    antiScam.setEnabled("g-legit3", true);
    const msg = fakeMessage({ content: "hello how are you today", guildId: "g-legit3" });
    await antiScam.checkMessage(CLIENT, msg);
    assert.strictEqual(msg._deleted.value, false);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
