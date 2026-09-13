/**
 * Clean Chat Vocal (protection personnelle, "!!panel",
 * utils/personalProtection.js) — supprime les messages du propriétaire d'un
 * salon vocal temporaire, postés dans le CHAT de ce salon, après 5 minutes.
 *
 * setTimeout est intercepté (pas de vraie attente de 5 minutes) pour
 * vérifier QUOI est planifié, avec QUEL délai, sans ralentir les tests.
 *
 * Lancement : node scripts/test-clean-chat-vocal.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "clean-chat-vocal-test-"));

const { ChannelType } = require("discord.js");
const personalProtection = require("../utils/personalProtection");
const store = require("../utils/personalProtectionStore");
const voiceChannels = require("../utils/voiceChannels");

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

function interceptSetTimeout() {
  const original = global.setTimeout;
  const appels = [];
  global.setTimeout = (fn, delay) => {
    appels.push({ fn, delay });
    return 0;
  };
  return {
    appels,
    restore: () => {
      global.setTimeout = original;
    },
  };
}

function fakeMessage({ guildId = "g1", authorId = "owner-1", channelId = "chan-1", authorBot = false } = {}) {
  return {
    guild: { id: guildId },
    author: { id: authorId, bot: authorBot },
    channel: { id: channelId, type: ChannelType.GuildVoice },
    delete: async function () {
      this._deleted = true;
    },
  };
}

(async () => {
  console.log("Clean Chat Vocal (messageCreate, chat d'un salon vocal temporaire) :");

  await cas("un message du PROPRIÉTAIRE dans le chat de SON salon planifie une suppression après 5 minutes", async () => {
    voiceChannels.registerChannel("chan-1", "g1", "owner-1");
    store.toggle("g1", "owner-1", "cleanChatVocal");
    const message = fakeMessage({});
    const timer = interceptSetTimeout();

    await personalProtection.enforceCleanVoiceChat(message);
    timer.restore();

    assert.strictEqual(timer.appels.length, 1);
    assert.strictEqual(timer.appels[0].delay, 5 * 60_000);
    await timer.appels[0].fn();
    assert.strictEqual(message._deleted, true);
  });

  await cas("un message d'un AUTRE membre (pas le propriétaire) n'est jamais planifié", async () => {
    voiceChannels.registerChannel("chan-2", "g2", "owner-2");
    store.toggle("g2", "invite-2", "cleanChatVocal");
    const message = fakeMessage({ guildId: "g2", authorId: "invite-2", channelId: "chan-2" });
    const timer = interceptSetTimeout();

    await personalProtection.enforceCleanVoiceChat(message);
    timer.restore();
    assert.strictEqual(timer.appels.length, 0);
  });

  await cas("protection désactivée : aucune planification", async () => {
    voiceChannels.registerChannel("chan-3", "g3", "owner-3");
    // "cleanChatVocal" jamais activé
    const message = fakeMessage({ guildId: "g3", authorId: "owner-3", channelId: "chan-3" });
    const timer = interceptSetTimeout();

    await personalProtection.enforceCleanVoiceChat(message);
    timer.restore();
    assert.strictEqual(timer.appels.length, 0);
  });

  await cas("un salon TEXTUEL (pas vocal) n'est jamais concerné", async () => {
    store.toggle("g4", "owner-4", "cleanChatVocal");
    const message = { guild: { id: "g4" }, author: { id: "owner-4", bot: false }, channel: { id: "salon-texte-4", type: ChannelType.GuildText } };
    const timer = interceptSetTimeout();

    await personalProtection.enforceCleanVoiceChat(message);
    timer.restore();
    assert.strictEqual(timer.appels.length, 0);
  });

  await cas("un salon vocal qui n'est PAS un salon temporaire n'est jamais concerné", async () => {
    store.toggle("g5", "owner-5", "cleanChatVocal");
    const message = fakeMessage({ guildId: "g5", authorId: "owner-5", channelId: "chan-5-jamais-enregistre" });
    const timer = interceptSetTimeout();

    await personalProtection.enforceCleanVoiceChat(message);
    timer.restore();
    assert.strictEqual(timer.appels.length, 0);
  });

  await cas("un message de bot est ignoré", async () => {
    voiceChannels.registerChannel("chan-6", "g6", "owner-6");
    store.toggle("g6", "owner-6", "cleanChatVocal");
    const message = fakeMessage({ guildId: "g6", authorId: "owner-6", channelId: "chan-6", authorBot: true });
    const timer = interceptSetTimeout();

    await personalProtection.enforceCleanVoiceChat(message);
    timer.restore();
    assert.strictEqual(timer.appels.length, 0);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
