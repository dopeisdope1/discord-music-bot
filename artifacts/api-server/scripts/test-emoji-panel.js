/**
 * Vérifie "&emoji" (utils/emojiPanel.js) : validation d'un emoji saisi, en
 * particulier le raccourci court ":nom:" (sans les chevrons ni l'ID) qui
 * remplace le besoin de taper "\" devant un emoji dans un salon pour
 * récupérer son code complet — geste desktop, sans équivalent sur mobile.
 *
 * Lancement : node scripts/test-emoji-panel.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "emoji-panel-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection } = require("discord.js");
const emojiPanel = require("../utils/emojiPanel");
const categoryEmojiStore = require("../utils/categoryEmojiStore");

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

function fakeEmoji(id, name, animated = false) {
  return {
    id,
    name,
    animated,
    toString() {
      return `<${animated ? "a" : ""}:${this.name}:${this.id}>`;
    },
  };
}

function makeGuild(emojis = []) {
  return { id: "gemoji", emojis: { cache: new Collection(emojis.map((e) => [e.id, e])) } };
}

function fakeMessage(guild) {
  const message = {
    guild,
    member: { id: "owner-1", guild, roles: { cache: new Collection() } },
    reply: async (p) => {
      message._reply = p;
    },
  };
  return message;
}

(async () => {
  console.log('"&emoji <clé> :nom:" — raccourci court, sans "\\" (pas d\'équivalent mobile) :');

  await cas('":nom:" résout un emoji du serveur, y compris avec des caractères hors [a-zA-Z0-9_] dans le nom', async () => {
    const guild = makeGuild([fakeEmoji("111111111111111111", "voice_channel~1")]);
    const message = fakeMessage(guild);
    await emojiPanel.handleEmojiTextCommand(null, message, ["success", ":voice_channel~1:"]);
    assert.ok(message._reply.includes("<:voice_channel~1:111111111111111111>"), message._reply);
    assert.strictEqual(categoryEmojiStore.get("gemoji", "icon:SUCCESS"), "<:voice_channel~1:111111111111111111>");
  });

  await cas('":nom:" est insensible à la casse', async () => {
    const guild = makeGuild([fakeEmoji("222222222222222222", "VoiceChannel")]);
    const message = fakeMessage(guild);
    await emojiPanel.handleEmojiTextCommand(null, message, ["error", ":voicechannel:"]);
    assert.ok(message._reply.includes("<:VoiceChannel:222222222222222222>"), message._reply);
  });

  await cas('":nom:" détecte automatiquement un emoji ANIMÉ (préfixe "a:")', async () => {
    const guild = makeGuild([fakeEmoji("333333333333333333", "danse", true)]);
    const message = fakeMessage(guild);
    await emojiPanel.handleEmojiTextCommand(null, message, ["info", ":danse:"]);
    assert.ok(message._reply.includes("<a:danse:333333333333333333>"), message._reply);
  });

  await cas('":nom:" pour un emoji qui n\'existe pas sur CE serveur est refusé, avec une explication', async () => {
    const guild = makeGuild([fakeEmoji("444444444444444444", "autre")]);
    const message = fakeMessage(guild);
    await emojiPanel.handleEmojiTextCommand(null, message, ["success", ":inconnu:"]);
    assert.ok(message._reply.includes("ne ressemble pas"), message._reply);
    assert.ok(message._reply.includes(":nom:"), "l'erreur doit rappeler le format court");
  });

  console.log("\nFormats déjà acceptés — non régression :");

  await cas("un emoji unicode classique reste accepté", async () => {
    const guild = makeGuild();
    const message = fakeMessage(guild);
    await emojiPanel.handleEmojiTextCommand(null, message, ["success", "🎉"]);
    assert.ok(message._reply.includes("🎉"), message._reply);
  });

  await cas("le code complet <:nom:id> reste accepté, y compris pour un emoji d'un AUTRE serveur", async () => {
    const guild = makeGuild(); // aucun emoji connu localement
    const message = fakeMessage(guild);
    await emojiPanel.handleEmojiTextCommand(null, message, ["success", "<:autre:987654321012345678>"]);
    assert.ok(message._reply.includes("<:autre:987654321012345678>"), message._reply);
  });

  await cas("une phrase (pas un emoji) reste refusée", async () => {
    const guild = makeGuild();
    const message = fakeMessage(guild);
    await emojiPanel.handleEmojiTextCommand(null, message, ["success", "pas", "un", "emoji"]);
    assert.ok(message._reply.includes("ne ressemble pas"), message._reply);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? ", des échecs sont survenus." : ", tout est vert."}`);
})();
