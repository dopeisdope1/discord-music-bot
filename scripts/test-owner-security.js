/**
 * "!!owner <@membre>" (utils/serverAdminCommands.js::handleSecurityOwnerTextCommand)
 * — carte "Owner" (buildOwnerAccessCard) filtrée à la SEULE catégorie
 * "protection" du VRAI catalogue : jamais modération/salons/membres/logs/
 * panel/serveur, qui n'ont rien à faire dans un menu "sécurité". Même
 * mécanisme que "=add"/"&owner" (utils/permissions/store.js + catalog.js),
 * juste un filtre de catégorie différent.
 *
 * Lancement : node scripts/test-owner-security.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "owner-security-test-"));
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

function fakeGuild(id) {
  const targetMember = { id: TARGET, user: { id: TARGET, tag: "cible#0001" } };
  return { id, members: { fetch: async (uid) => (uid === TARGET ? targetMember : null) } };
}

function fakeMessage({ guildId = "g1", authorId = "staff-1", content } = {}) {
  const replies = [];
  const guild = fakeGuild(guildId);
  return {
    content,
    author: { id: authorId, bot: false, tag: `${authorId}#0000` },
    guild,
    member: { id: authorId, guild, roles: { cache: new Collection() } },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

function fakeInteraction(customId, { userId = "staff-1", guildId = "g1", values } = {}) {
  const updates = [];
  const replies = [];
  const guild = fakeGuild(guildId);
  return {
    customId,
    guild,
    user: { id: userId, tag: `${userId}#0000` },
    member: { id: userId, guild, roles: { cache: new Collection() } },
    values,
    update: async (p) => updates.push(p),
    reply: async (p) => replies.push(p),
    _updates: updates,
    _replies: replies,
  };
}

(async () => {
  console.log("\"!!owner\" — dispatch sur le préfixe \"!!\" :");

  await cas("le préfixe \"!!\" (protection) est bien distinct de \"&\" et \"=\"", () => {
    const { protection, musicMod, owner } = getPrefixes("g-quelconque");
    assert.strictEqual(protection, "!!");
    assert.notStrictEqual(protection, musicMod);
    assert.notStrictEqual(protection, owner);
  });

  await cas("sans panel.permissions.manage, silence", async () => {
    const msg = fakeMessage({ guildId: "g1", authorId: "u1", content: `!!owner <@${TARGET}>` });
    await serverAdmin.handleSecurityOwnerTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("avec la permission, ouvre la carte \"Owner\"", async () => {
    permStore.grantToUser("g2", "staff-2", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g2", authorId: "staff-2", content: `!!owner <@${TARGET}>` });
    await serverAdmin.handleSecurityOwnerTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 1);
    const texte = JSON.stringify(msg._replies[0].components);
    assert.ok(texte.includes("## Owner"), texte);
  });

  console.log("\nFiltrage réel à la seule catégorie sécurité :");

  await cas("le sélecteur de catégories ne liste QUE Protection", async () => {
    permStore.grantToUser("g3", "staff-3", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g3", authorId: "staff-3", content: `!!owner <@${TARGET}>` });
    await serverAdmin.handleSecurityOwnerTextCommand(null, msg);
    const texte = JSON.stringify(msg._replies[0].components);
    assert.ok(texte.includes("Protection"), texte);
    for (const label of ["Modération", "Salons", "Membres", "Logs", "Panel", "Serveur"]) {
      assert.ok(!texte.includes(`"label":"${label}"`), `catégorie interdite présente : ${label}\n${texte}`);
    }
  });

  await cas("une permission de modération (moderation.*) déjà accordée n'apparaît PAS dans le résumé", async () => {
    permStore.grantToUser("g4", "staff-4", "panel.permissions.manage");
    permStore.grantToUser("g4", TARGET, "moderation.kick");
    permStore.grantToUser("g4", TARGET, "protection.whitelist");
    const msg = fakeMessage({ guildId: "g4", authorId: "staff-4", content: `!!owner <@${TARGET}>` });
    await serverAdmin.handleSecurityOwnerTextCommand(null, msg);
    const texte = JSON.stringify(msg._replies[0].components);
    assert.ok(texte.includes("Accès attribués — 1"), texte); // seule protection.whitelist compte
    assert.ok(!texte.includes("moderation.kick"), texte);
  });

  await cas("choisir \"protection\" révèle bien ses clés, avec le bon customId dédié", async () => {
    permStore.grantToUser("g5", "staff-5", "panel.permissions.manage");
    const interaction = fakeInteraction(`srv:secownercat:${TARGET}`, { userId: "staff-5", guildId: "g5", values: ["protection"] });
    await serverAdmin.handleServerAdminInteraction(interaction);
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(texte.includes("srv:secownerkey"), texte);
  });

  await cas("accorder une clé de sécurité via \"srv:secownerkey\" fonctionne réellement", async () => {
    permStore.grantToUser("g6", "staff-6", "panel.permissions.manage");
    const interaction = fakeInteraction(`srv:secownerkey:${TARGET}:protection`, {
      userId: "staff-6",
      guildId: "g6",
      values: ["protection.guard.manage"],
    });
    await serverAdmin.handleServerAdminInteraction(interaction);
    assert.ok(permStore.getUserGrants("g6", TARGET).includes("protection.guard.manage"));
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(texte.includes("Accès attribués — 1"), texte);
  });

  await cas("le filtre reste appliqué après bascule (jamais les catégories modération/serveur)", async () => {
    permStore.grantToUser("g7", "staff-7", "panel.permissions.manage");
    const interaction = fakeInteraction(`srv:secownerkey:${TARGET}:protection`, {
      userId: "staff-7",
      guildId: "g7",
      values: ["protection.automod"],
    });
    await serverAdmin.handleServerAdminInteraction(interaction);
    const texte = JSON.stringify(interaction._updates[0].components);
    for (const label of ["Modération", "Salons", "Membres", "Logs", "Panel", "Serveur"]) {
      assert.ok(!texte.includes(`"label":"${label}"`), `catégorie interdite réapparue : ${label}`);
    }
  });

  console.log("\nIsolation des préfixes / mots :");

  await cas("un mot inconnu sur ce préfixe reste silencieux", async () => {
    const msg = fakeMessage({ guildId: "g8", authorId: "staff-8", content: "!!nimportequoi" });
    await serverAdmin.handleSecurityOwnerTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("\"&owner\"/\"=owner\" (mauvais préfixe) ne déclenchent jamais cette commande", async () => {
    permStore.grantToUser("g9", "staff-9", "panel.permissions.manage");
    const msg1 = fakeMessage({ guildId: "g9", authorId: "staff-9", content: `&owner <@${TARGET}>` });
    await serverAdmin.handleSecurityOwnerTextCommand(null, msg1);
    assert.strictEqual(msg1._replies.length, 0);
    const msg2 = fakeMessage({ guildId: "g9", authorId: "staff-9", content: `=owner <@${TARGET}>` });
    await serverAdmin.handleSecurityOwnerTextCommand(null, msg2);
    assert.strictEqual(msg2._replies.length, 0);
  });

  await cas("un message de bot est ignoré", async () => {
    permStore.grantToUser("g10", "staff-10", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g10", authorId: "staff-10", content: `!!owner <@${TARGET}>` });
    msg.author.bot = true;
    await serverAdmin.handleSecurityOwnerTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("sans panel.permissions.manage, \"srv:secownerkey\" est refusé", async () => {
    const interaction = fakeInteraction(`srv:secownerkey:${TARGET}:protection`, {
      userId: "sans-perm",
      guildId: "g11",
      values: ["protection.automod"],
    });
    await serverAdmin.handleServerAdminInteraction(interaction);
    assert.strictEqual(interaction._updates.length, 0);
    assert.strictEqual(interaction._replies.length, 1);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
