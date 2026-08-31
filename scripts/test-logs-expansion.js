/**
 * Vérifie l'extension du système de logs (utils/modLogStore.js,
 * utils/moderationLog.js, &panel > Logs) : nouvelles catégories (rôles,
 * salons, vocal), nouveaux journaux (édition de message, activité vocale —
 * silencieuse sur les salons vocaux temporaires pour ne pas noyer le
 * salon de logs), et le cycle créer/supprimer/recréer des salons de logs.
 *
 * Lancement : node scripts/test-logs-expansion.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "logsexp-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { CATEGORIES, CATEGORY_LABELS, setLogChannelId, getAllLogChannels } = require("../utils/modLogStore");
const { logVoiceStateChange, logMessageEdit } = require("../utils/moderationLog");
const voiceChannels = require("../utils/voiceChannels");
const { buildConfigPanel, handleConfigInteraction, ID } = require("../utils/configPanel");

let reussis = 0;
async function cas(nom, fn) {
  try {
    await fn();
    reussis++;
    console.log(`  ok — ${nom}`);
  } catch (err) {
    console.error(`  ÉCHEC — ${nom}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("Catégories de logs étendues :");

cas("8 catégories, incluant rôles/salons/vocal", () => {
  assert.deepStrictEqual(CATEGORIES, ["moderation", "members", "roles", "channels", "voice", "server", "bots", "messages"]);
  for (const c of CATEGORIES) assert.ok(CATEGORY_LABELS[c], `label manquant pour ${c}`);
});

console.log("\nJournal vocal (nouveau) :");

(async () => {
  await cas("un rejoint dans un VRAI salon vocal est journalisé", async () => {
    const sent = [];
    const logChannel = { id: "logchan", isTextBased: () => true, send: async (p) => { sent.push(p); return {}; } };
    const guild = { id: "g-voice-1", channels: { cache: new Collection([["logchan", logChannel]]) } };
    const client = { user: { id: "bot-1" }, guilds: { cache: new Collection([["g-voice-1", guild]]) } };
    setLogChannelId("g-voice-1", "voice", "logchan");
    const member = { id: "u1", user: { id: "u1", tag: "membre#0001", bot: false } };
    await logVoiceStateChange(client, { channelId: null, member }, { channelId: "vc-real", member, guild });
    assert.strictEqual(sent.length, 1);
  });

  await cas("un salon vocal TEMPORAIRE (&voicehub) n'est jamais journalisé", async () => {
    const sent = [];
    const logChannel = { id: "logchan2", isTextBased: () => true, send: async (p) => { sent.push(p); return {}; } };
    const guild = { id: "g-voice-2", channels: { cache: new Collection([["logchan2", logChannel]]) } };
    const client = { user: { id: "bot-1" }, guilds: { cache: new Collection([["g-voice-2", guild]]) } };
    setLogChannelId("g-voice-2", "voice", "logchan2");
    voiceChannels.registerChannel("vc-temp-1", "g-voice-2", "someone");
    const member = { id: "u1", user: { id: "u1", tag: "membre#0001", bot: false } };
    await logVoiceStateChange(client, { channelId: null, member }, { channelId: "vc-temp-1", member, guild });
    assert.strictEqual(sent.length, 0);
  });

  console.log("\nJournal d'édition de message (nouveau) :");

  await cas("une édition avec contenu changé est journalisée", async () => {
    const sent = [];
    const logChannel = { id: "logchan3", isTextBased: () => true, send: async (p) => { sent.push(p); return {}; } };
    const guild = { id: "g-msg-1", channels: { cache: new Collection([["logchan3", logChannel]]) } };
    const client = { user: { id: "bot-1" }, guilds: { cache: new Collection([["g-msg-1", guild]]) } };
    setLogChannelId("g-msg-1", "messages", "logchan3");
    const oldMsg = { content: "avant", guild, author: { id: "u1", bot: false }, channel: { id: "c1" } };
    const newMsg = { content: "après", guild, author: { id: "u1", bot: false }, channel: { id: "c1" }, url: "https://discord.com/x" };
    await logMessageEdit(client, oldMsg, newMsg);
    assert.strictEqual(sent.length, 1);
  });

  await cas("une édition SANS changement de contenu n'est pas journalisée", async () => {
    const sent = [];
    const logChannel = { id: "logchan4", isTextBased: () => true, send: async (p) => { sent.push(p); return {}; } };
    const guild = { id: "g-msg-2", channels: { cache: new Collection([["logchan4", logChannel]]) } };
    const client = { user: { id: "bot-1" }, guilds: { cache: new Collection([["g-msg-2", guild]]) } };
    setLogChannelId("g-msg-2", "messages", "logchan4");
    const msg = { content: "identique", guild, author: { id: "u1", bot: false }, channel: { id: "c1" } };
    await logMessageEdit(client, msg, { ...msg, url: "x" });
    assert.strictEqual(sent.length, 0);
  });

  console.log("\nCycle créer / supprimer / recréer les salons de logs (&panel > Logs) :");

  await cas("créer -> supprimer -> recréer fonctionne pour les 8 catégories", async () => {
    const createdChannels = new Map();
    let idCounter = 0;
    const guild = {
      id: "g-cycle-1",
      roles: { cache: new Collection(), everyone: { id: "everyone" } },
      members: { me: { permissions: new PermissionsBitField(PermissionsBitField.All) }, cache: new Collection() },
      channels: {
        cache: {
          find: (fn) => [...createdChannels.values()].find(fn),
          get: (id) => createdChannels.get(id),
          has: (id) => createdChannels.has(id),
        },
        create: async (opts) => {
          const id = `ch${++idCounter}`;
          const ch = { id, name: opts.name, type: opts.type, delete: async () => createdChannels.delete(id) };
          createdChannels.set(id, ch);
          return ch;
        },
      },
    };
    const owner = { id: "owner-1", guild, roles: { cache: new Collection() } };
    const fakeInteraction = (customId) => ({
      customId: `${ID}:${customId}`,
      member: owner,
      guild,
      isModalSubmit: () => false,
      reply: async () => {},
      update: async () => {},
    });

    await handleConfigInteraction(fakeInteraction("logauto"));
    const afterCreate = getAllLogChannels("g-cycle-1");
    assert.ok(CATEGORIES.every((c) => afterCreate[c]), "toutes les catégories devraient avoir un salon après création");

    await handleConfigInteraction(fakeInteraction("logdelete"));
    const afterDelete = getAllLogChannels("g-cycle-1");
    assert.ok(CATEGORIES.every((c) => !afterDelete[c]), "toutes les catégories devraient être vidées après suppression");
    assert.strictEqual(createdChannels.size, 1, "seule la catégorie de salons \"Logs\" (le dossier) doit rester, pas un salon de logs");

    await handleConfigInteraction(fakeInteraction("logauto"));
    const afterRecreate = getAllLogChannels("g-cycle-1");
    assert.ok(CATEGORIES.every((c) => afterRecreate[c]), "toutes les catégories devraient avoir un salon après recréation");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
