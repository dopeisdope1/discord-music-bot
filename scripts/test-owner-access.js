/**
 * "=owner <@membre>" (utils/serverAdminCommands.js::handleOwnerAccessTextCommand)
 * — demandée sur une capture d'un AUTRE bot (commandes "follow"/"pv"/
 * "wakeup"/"dog"... qui n'existent PAS ici) : plutôt que d'inventer un accès
 * fictif, "=owner" délègue exactement à "&access" (même VRAI catalogue de
 * permissions), sur un préfixe séparé exprès ("=" au lieu de "&").
 *
 * Lancement : node scripts/test-owner-access.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "owner-access-test-"));
process.env.BOT_OWNER_IDS = "";

const { Collection } = require("discord.js");
const serverAdmin = require("../utils/serverAdminCommands");
const permStore = require("../utils/permissions/store");
const { getPrefixes } = require("../utils/prefixStore");

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

const TARGET = "999888777000111222";

function fakeGuild(id, { hasTarget = true } = {}) {
  const targetMember = { id: TARGET, user: { id: TARGET, tag: "cible#0001" } };
  return {
    id,
    members: { fetch: async (uid) => (hasTarget && uid === TARGET ? targetMember : null) },
  };
}

function fakeMessage({ guildId = "g1", authorId = "staff-1", content, hasTarget = true } = {}) {
  const replies = [];
  const guild = fakeGuild(guildId, { hasTarget });
  return {
    content,
    author: { id: authorId, bot: false },
    guild,
    member: { id: authorId, guild, roles: { cache: new Collection() } },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

(async () => {
  console.log("Préfixe dédié \"=\" :");

  await cas("le préfixe par défaut est \"=\", distinct de \"&\" et \"!!\"", () => {
    const { owner, musicMod, protection } = getPrefixes("g-quelconque");
    assert.strictEqual(owner, "=");
    assert.notStrictEqual(owner, musicMod);
    assert.notStrictEqual(owner, protection);
  });

  console.log("\n\"=owner\" — dispatch et délégation vers le VRAI mécanisme d'accès :");

  await cas("sans panel.permissions.manage, silence", async () => {
    const msg = fakeMessage({ guildId: "g1", authorId: "u1", content: `=owner <@${TARGET}>` });
    await serverAdmin.handleOwnerAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("avec panel.permissions.manage, ouvre le MÊME panneau que &access", async () => {
    permStore.grantToUser("g2", "staff-2", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g2", authorId: "staff-2", content: `=owner <@${TARGET}>` });
    await serverAdmin.handleOwnerAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 1);
    const texte = JSON.stringify(msg._replies[0].components);
    assert.ok(texte.includes("cible#0001"), texte);
  });

  await cas("un ID brut fonctionne aussi bien qu'une mention", async () => {
    permStore.grantToUser("g3", "staff-3", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g3", authorId: "staff-3", content: `=owner ${TARGET}` });
    await serverAdmin.handleOwnerAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 1);
  });

  await cas("sans argument, le message d'erreur rappelle SA PROPRE syntaxe (\"owner @membre\", pas \"access @membre\")", async () => {
    permStore.grantToUser("g4", "staff-4", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g4", authorId: "staff-4", content: "=owner" });
    await serverAdmin.handleOwnerAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 1);
    const texte = JSON.stringify(msg._replies[0]);
    assert.ok(texte.includes("owner @membre"), texte);
    assert.ok(!texte.includes("access @membre"), texte);
  });

  await cas("membre introuvable sur le serveur : message clair, pas de plantage", async () => {
    permStore.grantToUser("g5", "staff-5", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g5", authorId: "staff-5", content: `=owner <@${TARGET}>`, hasTarget: false });
    await serverAdmin.handleOwnerAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 1);
  });

  console.log("\nIsolation des préfixes :");

  await cas("un mot inconnu sur ce préfixe reste silencieux", async () => {
    const msg = fakeMessage({ guildId: "g6", authorId: "staff-6", content: "=nimportequoi" });
    await serverAdmin.handleOwnerAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("\"&owner\" (mauvais préfixe) ne déclenche jamais cette commande", async () => {
    permStore.grantToUser("g7", "staff-7", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g7", authorId: "staff-7", content: `&owner <@${TARGET}>` });
    await serverAdmin.handleOwnerAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("un message de bot est ignoré", async () => {
    permStore.grantToUser("g8", "staff-8", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g8", authorId: "staff-8", content: `=owner <@${TARGET}>` });
    msg.author.bot = true;
    await serverAdmin.handleOwnerAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
