/**
 * Vérifie l'automod léger ajouté (anti-lien, anti-mass-mention, mots
 * interdits) : utils/automod/antiLink.js, antiMention.js, badWords.js.
 *
 * DATA_DIR pointe vers un dossier temporaire créé pour ce process.
 *
 * Lancement : node scripts/test-automod.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "automod-test-"));

const antiLink = require("../utils/automod/antiLink");
const antiMention = require("../utils/automod/antiMention");
const badWords = require("../utils/automod/badWords");
const { Collection } = require("discord.js");

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
async function casAsync(nom, fn) {
  try {
    await fn();
    reussis++;
    console.log(`  ok — ${nom}`);
  } catch (err) {
    console.error(`  ÉCHEC — ${nom}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

function fakeMember(id, guildId = "g1", roles = []) {
  return { id, guild: { id: guildId }, roles: { cache: new Collection(roles.map((r) => [r, { id: r }])) } };
}

function fakeMessage({ content = "", authorId = "u1", channelId = "c1", deletable = true } = {}) {
  const deleted = { value: false };
  return {
    author: { id: authorId, bot: false, tag: `${authorId}#0000` },
    member: fakeMember(authorId),
    guild: { id: "g1" },
    channel: { id: channelId, toString: () => `<#${channelId}>` },
    content,
    deletable,
    delete: async () => {
      deleted.value = true;
    },
    mentions: { users: new Collection(), roles: new Collection() },
    _deleted: deleted,
  };
}

console.log("Anti-lien — configuration :");

cas("désactivé par défaut, mode invite par défaut", () => {
  const config = antiLink.getConfig("g1");
  assert.strictEqual(config.enabled, false);
  assert.strictEqual(config.mode, "invite");
});

cas("un salon exempté est retrouvé, puis retiré", () => {
  antiLink.setChannelAllowed("g1", "c1", true);
  assert.deepStrictEqual(antiLink.getAllowedChannels("g1"), ["c1"]);
  antiLink.setChannelAllowed("g1", "c1", false);
  assert.deepStrictEqual(antiLink.getAllowedChannels("g1"), []);
});

console.log("\nAnti-lien — détection :");

(async () => {
  await casAsync("ne fait rien si désactivé", async () => {
    const msg = fakeMessage({ content: "https://discord.gg/abcd" });
    await antiLink.checkMessage(null, msg);
    assert.strictEqual(msg._deleted.value, false);
  });

  await casAsync("supprime une invitation Discord une fois activé", async () => {
    antiLink.setEnabled("g1", true);
    const msg = fakeMessage({ content: "rejoins discord.gg/abcd" });
    await antiLink.checkMessage({ user: { id: "bot" } }, msg);
    assert.strictEqual(msg._deleted.value, true);
  });

  await casAsync("laisse passer un lien non-invitation en mode 'invite'", async () => {
    const msg = fakeMessage({ content: "https://example.com" });
    await antiLink.checkMessage({ user: { id: "bot" } }, msg);
    assert.strictEqual(msg._deleted.value, false);
  });

  await casAsync("supprime tout lien en mode 'all'", async () => {
    antiLink.setMode("g1", "all");
    const msg = fakeMessage({ content: "https://example.com" });
    await antiLink.checkMessage({ user: { id: "bot" } }, msg);
    assert.strictEqual(msg._deleted.value, true);
  });

  await casAsync("un salon exempté n'est pas filtré", async () => {
    antiLink.setChannelAllowed("g1", "c2", true);
    const msg = fakeMessage({ content: "https://example.com", channelId: "c2" });
    await antiLink.checkMessage({ user: { id: "bot" } }, msg);
    assert.strictEqual(msg._deleted.value, false);
  });

  console.log("\nAnti-mass-mention :");

  await casAsync("ne déclenche pas sous le seuil", async () => {
    antiMention.setEnabled("g1", true);
    antiMention.setMaxMentions("g1", 3);
    const msg = fakeMessage({ authorId: "u2" });
    msg.mentions.users = new Collection([1, 2].map((i) => [String(i), {}]));
    msg.member.moderatable = true;
    msg.member.timeout = async () => {};
    await antiMention.checkMessage({ user: { id: "bot" } }, msg);
    assert.strictEqual(msg._deleted.value, false);
  });

  await casAsync("supprime et timeout au-delà du seuil", async () => {
    const msg = fakeMessage({ authorId: "u3" });
    msg.mentions.users = new Collection([1, 2, 3, 4].map((i) => [String(i), {}]));
    let timedOut = false;
    msg.member.moderatable = true;
    msg.member.communicationDisabledUntil = null;
    msg.member.timeout = async () => {
      timedOut = true;
    };
    await antiMention.checkMessage({ user: { id: "bot" } }, msg);
    assert.strictEqual(msg._deleted.value, true);
    assert.strictEqual(timedOut, true);
  });

  console.log("\nMots interdits :");

  await casAsync("ajouter/retirer un mot fonctionne dans les deux sens", async () => {
    assert.strictEqual(badWords.addWord("g1", "vilainmot"), true);
    assert.strictEqual(badWords.addWord("g1", "vilainmot"), false); // déjà présent
    assert.deepStrictEqual(badWords.getWords("g1"), ["vilainmot"]);
    assert.strictEqual(badWords.removeWord("g1", "vilainmot"), true);
    assert.deepStrictEqual(badWords.getWords("g1"), []);
  });

  await casAsync("supprime un message contenant un mot interdit (activé)", async () => {
    badWords.addWord("g1", "vilainmot");
    badWords.setEnabled("g1", true);
    const msg = fakeMessage({ content: "un vilainmot ici", authorId: "u4" });
    await badWords.checkMessage({ user: { id: "bot" } }, msg);
    assert.strictEqual(msg._deleted.value, true);
  });

  await casAsync("ne supprime pas un message sans mot interdit", async () => {
    const msg = fakeMessage({ content: "message tout à fait correct", authorId: "u5" });
    await badWords.checkMessage({ user: { id: "bot" } }, msg);
    assert.strictEqual(msg._deleted.value, false);
  });

  await casAsync("clearWords vide toute la liste", async () => {
    badWords.clearWords("g1");
    assert.deepStrictEqual(badWords.getWords("g1"), []);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
