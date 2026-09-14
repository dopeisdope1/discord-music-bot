/**
 * "&h" (utils/serverAdminCommands.js::voiceHelp) — rappel compact des
 * commandes "&voc" (mêmes sous-commandes, jamais dupliquées), demande
 * explicite : "un help voc perso... uniquement visible dans la vocale créée
 * temporairement" (inspiré d'une capture d'un autre bot, juste la fonction
 * reprise avec la VRAIE syntaxe "&voc ..." de ce bot).
 *
 * Lancement : node scripts/test-voice-help.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "voice-help-test-"));
process.env.BOT_OWNER_IDS = "";

const voiceChannels = require("../utils/voiceChannels");
const { voiceHelp } = require("../utils/serverAdminCommands");

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

function fakeMessage({ authorId = "u1", voiceChannel = null } = {}) {
  const replies = [];
  return {
    author: { id: authorId },
    member: { id: authorId, voice: { channel: voiceChannel } },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

const texteDe = (payload) => JSON.stringify(payload.components ?? payload);

(async () => {
  console.log("&h — ne répond que depuis un vrai salon vocal temporaire :");

  await cas("pas connecté en vocal du tout : message d'erreur, pas de plantage", async () => {
    const msg = fakeMessage({});
    await voiceHelp(null, msg);
    assert.strictEqual(msg._replies.length, 1);
    assert.ok(texteDe(msg._replies[0]).toLowerCase().includes("salon vocal temporaire"));
  });

  await cas("connecté à un salon vocal NON temporaire (ex: le générateur) : refusé", async () => {
    const msg = fakeMessage({ voiceChannel: { id: "salon-permanent-1" } });
    await voiceHelp(null, msg);
    assert.strictEqual(msg._replies.length, 1);
    assert.ok(texteDe(msg._replies[0]).toLowerCase().includes("salon vocal temporaire"));
  });

  console.log("\n&h — dans un VRAI salon temporaire :");

  await cas("affiche les 7 vraies sous-commandes de &voc, avec la syntaxe réelle", async () => {
    voiceChannels.registerChannel("vocal-temp-1", "g1", "owner-du-salon");
    const msg = fakeMessage({ authorId: "n-importe-qui", voiceChannel: { id: "vocal-temp-1" } });
    await voiceHelp(null, msg);
    const texte = texteDe(msg._replies[0]);
    for (const attendu of [
      "&voc unlock",
      "&voc lock",
      "&voc add @membre",
      "&voc remove @membre",
      "&voc kick @membre",
      "&voc rename <nom>",
      "&voc limit <n>",
      "&voc transfer @membre",
    ]) {
      assert.ok(texte.includes(attendu), `"${attendu}" manque : ${texte}`);
    }
  });

  await cas("n'importe qui dans le salon peut le voir — pas réservé au propriétaire", async () => {
    voiceChannels.registerChannel("vocal-temp-2", "g1", "vrai-proprietaire");
    const msg = fakeMessage({ authorId: "un-invite-quelconque", voiceChannel: { id: "vocal-temp-2" } });
    await voiceHelp(null, msg);
    assert.strictEqual(msg._replies.length, 1);
    assert.ok(!texteDe(msg._replies[0]).toLowerCase().includes("propriétaire"));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
