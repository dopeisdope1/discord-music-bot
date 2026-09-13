/**
 * "!!help" (utils/protectionHelpCommand.js) — index des commandes "!!"
 * (panel/secur/confess/setclear), distinct de "&help" (gestion, préfixe
 * "&") — demande explicite : "&help pour la gestion, !!help pour la
 * sécurité". Purement informatif, aucune interaction.
 *
 * Lancement : node scripts/test-protection-help.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "protection-help-test-"));
process.env.BOT_OWNER_IDS = "";

const { handleProtectionHelpTextCommand } = require("../utils/protectionHelpCommand");

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

  await cas('un mot inconnu après "!!" reste silencieux', async () => {
    const msg = fakeMessage("!!nimportequoi");
    await handleProtectionHelpTextCommand(null, msg);
    assert.strictEqual(msg._channelSends.length, 0);
  });

  await cas('le préfixe "&" n\'est pas concerné', async () => {
    const msg = fakeMessage("&help");
    await handleProtectionHelpTextCommand(null, msg);
    assert.strictEqual(msg._channelSends.length, 0);
  });

  console.log("\n!!help — liste bien les commandes \"!!\" réelles :");

  await cas("ouvert à tout le monde, aucune permission requise", async () => {
    const msg = fakeMessage("!!help", { authorId: "quidam-1" });
    await handleProtectionHelpTextCommand(null, msg);
    assert.strictEqual(msg._channelSends.length, 1);
  });

  await cas("mentionne les 4 vraies commandes \"!!\" avec leur permission réelle", async () => {
    const msg = fakeMessage("!!help");
    await handleProtectionHelpTextCommand(null, msg);
    const texte = JSON.stringify(msg._channelSends[0].components);
    for (const attendu of [
      "!!panel",
      "!!secur",
      "!!confess",
      "!!setclear",
      "protection.automod",
      "protection.guard.manage",
      "server.confessions.setup",
      "server.confessions.validation",
      "server.confessions.manage",
      "server.selfclear.manage",
    ]) {
      assert.ok(texte.includes(attendu), `"${attendu}" manque : ${texte}`);
    }
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
