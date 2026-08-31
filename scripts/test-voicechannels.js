/**
 * Vérifie les salons vocaux temporaires (utils/voiceChannels.js) et la
 * commande &voc (utils/serverAdminCommands.js) : stockage propriétaire/
 * salon, contrôle refusé à qui n'est pas propriétaire — AUCUNE exception,
 * même le rang sys/owner du bot ne peut gérer un salon dont il n'est pas
 * propriétaire (plus de bypass, demande explicite).
 *
 * DATA_DIR pointe vers un dossier temporaire créé pour ce process.
 *
 * Lancement : node scripts/test-voicechannels.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vc-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const accessStore = require("../utils/accessStore");
const voiceChannels = require("../utils/voiceChannels");
const serverAdmin = require("../utils/serverAdminCommands");

const GUILD_ID = "g1";

function fakeChannel({ id, memberIds = [] }) {
  return {
    id,
    permissionOverwrites: { edit: async () => {} },
    setUserLimit: async function (n) { this.limit = n; },
    setName: async function (name) { this.name = name; },
    members: new Map(memberIds.map((m) => [m, m])),
  };
}

function fakeMessage({ authorId, voiceChannel }) {
  const replies = [];
  const guild = { id: GUILD_ID, roles: { everyone: { id: GUILD_ID } } };
  const member = { id: authorId, voice: { channel: voiceChannel }, guild };
  return {
    author: { id: authorId, tag: `${authorId}#0000` },
    member,
    guild,
    mentions: { members: { first: () => null } },
    reply: async (payload) => {
      replies.push(payload);
      return {};
    },
  };
}

let reussis = 0;
function cas(nom, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      reussis++;
      console.log(`  ok — ${nom}`);
    })
    .catch((err) => {
      console.error(`  ÉCHEC — ${nom}\n    ${err.stack}`);
      process.exitCode = 1;
    });
}

async function main() {
  console.log("Stockage :");

  cas("le hub est configurable et désactivable", () => {
    assert.strictEqual(voiceChannels.getHub(GUILD_ID), null);
    voiceChannels.setHub(GUILD_ID, "hub-1");
    assert.strictEqual(voiceChannels.getHub(GUILD_ID), "hub-1");
    voiceChannels.setHub(GUILD_ID, null);
    assert.strictEqual(voiceChannels.getHub(GUILD_ID), null);
  });

  cas("un salon enregistré retrouve son propriétaire, puis plus rien après désenregistrement", () => {
    voiceChannels.registerChannel("chan-1", GUILD_ID, "owner-of-chan");
    assert.deepStrictEqual(voiceChannels.getChannelInfo("chan-1"), { guildId: GUILD_ID, ownerId: "owner-of-chan" });
    voiceChannels.unregisterChannel("chan-1");
    assert.strictEqual(voiceChannels.getChannelInfo("chan-1"), null);
  });

  console.log("\nContrôle &voc :");

  await cas("le propriétaire du salon peut le renommer", async () => {
    const channel = fakeChannel({ id: "chan-2" });
    voiceChannels.registerChannel(channel.id, GUILD_ID, "vc-owner-1");
    const message = fakeMessage({ authorId: "vc-owner-1", voiceChannel: channel });
    await serverAdmin.vc(null, message, ["rename", "Salon", "sympa"]);
    assert.strictEqual(channel.name, "Salon sympa");
  });

  await cas("un membre qui n'est PAS propriétaire ne peut pas le gérer", async () => {
    const channel = fakeChannel({ id: "chan-3" });
    voiceChannels.registerChannel(channel.id, GUILD_ID, "vc-owner-2");
    const message = fakeMessage({ authorId: "random-member", voiceChannel: channel });
    await serverAdmin.vc(null, message, ["rename", "Vole", "le", "salon"]);
    assert.strictEqual(channel.name, undefined, "le salon n'aurait pas dû être renommé");
  });

  await cas("même le rang sys/owner du bot NE PEUT PAS gérer un salon dont il n'est pas propriétaire (plus de bypass)", async () => {
    // Demande explicite : owner/sys pouvait auparavant agir sur N'IMPORTE
    // QUEL salon temporaire sans en être le créateur — retiré entièrement,
    // aucune exception, ni ici ni depuis le panneau à boutons.
    accessStore.add("sys", "sys-user-1");
    const channel = fakeChannel({ id: "chan-4" });
    voiceChannels.registerChannel(channel.id, GUILD_ID, "someone-else");
    const message = fakeMessage({ authorId: "sys-user-1", voiceChannel: channel });
    await serverAdmin.vc(null, message, ["limit", "5"]);
    assert.strictEqual(channel.limit, undefined, "sys ne doit plus pouvoir gérer le salon de quelqu'un d'autre");
  });

  await cas("le propriétaire réel reste géré normalement (le retrait du bypass ne casse pas le cas courant)", async () => {
    const channel = fakeChannel({ id: "chan-4b" });
    voiceChannels.registerChannel(channel.id, GUILD_ID, "vrai-proprio");
    const message = fakeMessage({ authorId: "vrai-proprio", voiceChannel: channel });
    await serverAdmin.vc(null, message, ["limit", "5"]);
    assert.strictEqual(channel.limit, 5);
  });

  await cas("&voc refuse silencieusement hors d'un salon temporaire connu", async () => {
    const channel = fakeChannel({ id: "chan-not-registered" });
    const message = fakeMessage({ authorId: "vc-owner-1", voiceChannel: channel });
    await serverAdmin.vc(null, message, ["rename", "Test"]);
    assert.strictEqual(channel.name, undefined);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
}

main();
