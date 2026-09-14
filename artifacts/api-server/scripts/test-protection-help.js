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

function fakeMessage(content, { guildId = "g1", authorId = "u1", member } = {}) {
  const channelSends = [];
  return {
    content,
    author: { id: authorId, bot: false },
    guild: { id: guildId },
    member,
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

  const noAccess = {
    id: "plain-1",
    guild: { id: "g1" },
    roles: { cache: new Collection() },
    permissions: { has: () => false },
  };
  const owner = {
    id: "owner-1",
    guild: { id: "g1" },
    roles: { cache: new Collection() },
    permissions: { has: () => false },
  };

  await cas("un membre sans permissions ne voit pas les commandes sécurité protégées", async () => {
    const msg = fakeMessage("!!help", { member: noAccess });
    await handleProtectionHelpTextCommand(null, msg);
    const texte = JSON.stringify(msg._channelSends[0].components);
    for (const interdit of ["!!secur", "!!security", "!!owner", "!!wl", "!!antinuke", "!!antilink", "!!antispam", "!!setclear"]) {
      assert.ok(!texte.includes(interdit), `"${interdit}" ne devrait pas apparaître : ${texte}`);
    }
    assert.ok(texte.includes("!!panel"), texte);
  });

  await cas("BOT_OWNER_IDS voit toutes les commandes sécurité", async () => {
    process.env.BOT_OWNER_IDS = "owner-1";
    const msg = fakeMessage("!!help", { authorId: "owner-1", member: owner });
    await handleProtectionHelpTextCommand(null, msg);
    const texte = JSON.stringify(msg._channelSends[0].components);
    for (const attendu of ["!!secur", "!!security", "!!owner", "!!wl", "!!antinuke", "!!antilink", "!!antispam", "!!setclear"]) {
      assert.ok(texte.includes(attendu), `"${attendu}" manque : ${texte}`);
    }
  });

  await cas("mentionne les commandes \"!!\" historiques avec leur permission réelle", async () => {
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
    assert.ok(!texte.includes("!!lockdown"), "lockdown est modération-only et ne doit plus être listé sous !!");
  });

  console.log("\n!!help — écosystème sécurité (chantier 2/3) :");

  await cas("mentionne les nouveaux alias sécurité, groupés sous \"Sécurité serveur\"", async () => {
    const msg = fakeMessage("!!help");
    await handleProtectionHelpTextCommand(null, msg);
    const texte = JSON.stringify(msg._channelSends[0].components);
    for (const attendu of [
      "Sécurité serveur",
      "!!security",
      "!!owner",
      "!!wl",
      "!!unwl",
      "!!whitelist",
      "!!unwhitelist",
      "!!antinuke",
      "!!antiraid",
      "!!antilink",
      "!!antispam",
      "panel.permissions.manage",
      "protection.whitelist",
    ]) {
      assert.ok(texte.includes(attendu), `"${attendu}" manque : ${texte}`);
    }
  });

  await cas("\"!!panel\" reste groupé sous \"Protection personnelle\", pas confondu avec la sécurité serveur", async () => {
    const msg = fakeMessage("!!help");
    await handleProtectionHelpTextCommand(null, msg);
    const texte = JSON.stringify(msg._channelSends[0].components);
    assert.ok(texte.includes("Protection personnelle"), texte);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
