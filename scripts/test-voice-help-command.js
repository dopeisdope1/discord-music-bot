/**
 * "=help" (utils/voiceHelpCommand.js) — index des commandes "=" (écosystème
 * vocal), même patron que "!!help" (utils/protectionHelpCommand.js).
 * Purement informatif, aucune interaction, ouvert à tout le monde.
 *
 * Lancement : node scripts/test-voice-help-command.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "voice-help-test-"));
process.env.BOT_OWNER_IDS = "";

const { handleVoiceHelpTextCommand } = require("../utils/voiceHelpCommand");

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

function fakeMessage(content, { guildId = "g1", authorId = "u1" } = {}) {
  const channelSends = [];
  return {
    content,
    author: { id: authorId, bot: false },
    guild: { id: guildId },
    channel: { send: async (p) => channelSends.push(p) },
    _channelSends: channelSends,
  };
}

(async () => {
  console.log("Mot-clé et préfixe :");

  await cas('un mot inconnu après "=" reste silencieux', async () => {
    const msg = fakeMessage("=nimportequoi");
    await handleVoiceHelpTextCommand(null, msg);
    assert.strictEqual(msg._channelSends.length, 0);
  });

  await cas('le préfixe "&" n\'est pas concerné', async () => {
    const msg = fakeMessage("&help");
    await handleVoiceHelpTextCommand(null, msg);
    assert.strictEqual(msg._channelSends.length, 0);
  });

  await cas('le préfixe "!!" n\'est pas concerné', async () => {
    const msg = fakeMessage("!!help");
    await handleVoiceHelpTextCommand(null, msg);
    assert.strictEqual(msg._channelSends.length, 0);
  });

  console.log("\n=help — liste bien les commandes \"=\" réelles :");

  await cas("ouvert à tout le monde, aucune permission requise", async () => {
    const msg = fakeMessage("=help", { authorId: "quidam-1" });
    await handleVoiceHelpTextCommand(null, msg);
    assert.strictEqual(msg._channelSends.length, 1);
  });

  await cas("mentionne toutes les vraies commandes vocales", async () => {
    const msg = fakeMessage("=help");
    await handleVoiceHelpTextCommand(null, msg);
    const texte = JSON.stringify(msg._channelSends[0].components);
    for (const attendu of ["=mute", "=unmute", "=deaf", "=undeaf", "=disconnect", "=move"]) {
      assert.ok(texte.includes(attendu), `"${attendu}" manque : ${texte}`);
    }
  });

  await cas("présentation catégorisée (comme la capture) : catégories Administration + Voice avec compteur", async () => {
    const msg = fakeMessage("=help");
    await handleVoiceHelpTextCommand(null, msg);
    const texte = JSON.stringify(msg._channelSends[0].components);
    assert.ok(texte.includes("Administration"), texte);
    assert.ok(texte.includes("Voice"), texte);
    assert.ok(texte.includes("commande"), texte); // "X commandes"
  });

  await cas("ne mentionne PLUS de système de salon/propriété inventé (revert explicite, pas la demande)", async () => {
    const msg = fakeMessage("=help");
    await handleVoiceHelpTextCommand(null, msg);
    const texte = JSON.stringify(msg._channelSends[0].components);
    for (const mot of ["=lock", "=unlock", "=wl", "=unwl", "=vc", "=panel", "propriét"]) {
      assert.ok(!texte.includes(mot), `"${mot}" ne devrait plus apparaître : ${texte}`);
    }
  });

  await cas("inclut \"=add\"/\"=owner\" dans la catégorie Administration (vraies commandes du préfixe =)", async () => {
    const msg = fakeMessage("=help");
    await handleVoiceHelpTextCommand(null, msg);
    const texte = JSON.stringify(msg._channelSends[0].components);
    assert.ok(texte.includes("=add"), texte);
    assert.ok(texte.includes("=owner"), texte);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
