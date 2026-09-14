/**
 * Vérifie les extensions du catalogue Modération câblées à un vrai backend :
 * mute par rôle (utils/moderationExtra.js + utils/muteStore.js), tempban
 * (utils/tempBanStore.js), sanctions (suppression dans
 * utils/moderationHistoryStore.js), et la correction de sécurité sur &clear
 * (la cible doit être le premier argument, jamais "une mention trouvée
 * n'importe où").
 *
 * Lancement : node scripts/test-moderation-extra.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "modextra-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const muteStore = require("../utils/muteStore");
const tempBanStore = require("../utils/tempBanStore");
const historyStore = require("../utils/moderationHistoryStore");
const moderationExtra = require("../utils/moderationExtra");
const { moderationHandlers } = require("../utils/moderationCommands");

let reussis = 0;
function cas(nom, fn) {
  try {
    fn();
    reussis++;
    console.log(`  ok — ${nom}`);
  } catch (err) {
    console.error(`  ÉCHEC — ${nom}\n    ${err.message}`);
    process.exitCode = 1;
  }
}
async function casAsync(nom, fn) {
  try {
    await fn();
    reussis++;
    console.log(`  ok — ${nom}`);
  } catch (err) {
    console.error(`  ÉCHEC — ${nom}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("muteStore :");

cas("rôle de mute configurable, null par défaut", () => {
  assert.strictEqual(muteStore.getMuteRoleId("g1"), null);
  muteStore.setMuteRoleId("g1", "role-mute");
  assert.strictEqual(muteStore.getMuteRoleId("g1"), "role-mute");
});

cas("mute temporaire retrouvé puis retiré", () => {
  muteStore.addTempMute("g1", "u1", Date.now() - 1000); // déjà expiré
  assert.ok(muteStore.getExpiredTempMutes().some((m) => m.guildId === "g1" && m.userId === "u1"));
  muteStore.removeTempMute("g1", "u1");
  assert.ok(!muteStore.getExpiredTempMutes().some((m) => m.guildId === "g1" && m.userId === "u1"));
});

console.log("\ntempBanStore (fichier dédié, ne partage rien avec muteStore) :");

cas("tempban retrouvé puis retiré, indépendamment des mutes", () => {
  muteStore.addTempMute("g1", "u2", Date.now() - 1000);
  tempBanStore.add("g1", "u2", Date.now() - 1000); // même guildId/userId qu'un mute expiré, fichiers séparés
  assert.strictEqual(muteStore.getExpiredTempMutes().filter((m) => m.userId === "u2").length, 1);
  assert.strictEqual(tempBanStore.getExpired().filter((b) => b.userId === "u2").length, 1);
  muteStore.removeTempMute("g1", "u2");
  assert.strictEqual(tempBanStore.getExpired().filter((b) => b.userId === "u2").length, 1); // pas affecté par removeTempMute
  tempBanStore.remove("g1", "u2");
  assert.strictEqual(tempBanStore.getExpired().filter((b) => b.userId === "u2").length, 0);
});

console.log("\nHistorique des sanctions — suppression :");

cas("deleteById supprime une seule entrée", () => {
  const id = historyStore.record({ guildId: "g2", action: "kick", targetId: "t1", moderatorId: "m1", source: "bot" });
  assert.strictEqual(historyStore.search("g2", { targetId: "t1" }).length, 1);
  assert.strictEqual(historyStore.deleteById("g2", id), true);
  assert.strictEqual(historyStore.search("g2", { targetId: "t1" }).length, 0);
});

cas("deleteAllForTarget ne touche qu'un membre précis", () => {
  historyStore.record({ guildId: "g2", action: "kick", targetId: "t2", moderatorId: "m1", source: "bot" });
  historyStore.record({ guildId: "g2", action: "ban", targetId: "t2", moderatorId: "m1", source: "bot" });
  historyStore.record({ guildId: "g2", action: "kick", targetId: "t3", moderatorId: "m1", source: "bot" });
  assert.strictEqual(historyStore.deleteAllForTarget("g2", "t2"), 2);
  assert.strictEqual(historyStore.search("g2", { targetId: "t2" }).length, 0);
  assert.strictEqual(historyStore.search("g2", { targetId: "t3" }).length, 1);
});

cas("deleteAllForGuild ne touche pas les autres serveurs", () => {
  historyStore.record({ guildId: "g2", action: "kick", targetId: "t4", moderatorId: "m1", source: "bot" });
  historyStore.record({ guildId: "g3", action: "kick", targetId: "t4", moderatorId: "m1", source: "bot" });
  const removed = historyStore.deleteAllForGuild("g2");
  assert.ok(removed >= 1);
  assert.strictEqual(historyStore.search("g2", { targetId: "t4" }).length, 0);
  assert.strictEqual(historyStore.search("g3", { targetId: "t4" }).length, 1);
});

console.log("\nCorrection de sécurité — &clear (cible = premier argument uniquement) :");

const REAL_ID = "123456789012345678";
function fakeClearMessage(mentionsUsers) {
  const replies = [];
  return {
    author: { id: "staff-1", tag: "staff#0001" },
    member: {
      id: "staff-1",
      guild: { id: "g4", ownerId: "owner-x" },
      roles: { cache: new Collection(), highest: { position: 5 } },
      permissions: new PermissionsBitField(PermissionsBitField.All),
    },
    guild: {
      id: "g4",
      ownerId: "owner-x",
      members: { me: { id: "bot", permissions: new PermissionsBitField(PermissionsBitField.All), roles: { highest: { position: 10 } } } },
    },
    channel: { id: "c1", messages: { fetch: async () => new Collection() } },
    mentions: { users: new Collection(mentionsUsers ? [[mentionsUsers, { id: mentionsUsers, tag: "target#0001" }]] : []) },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

(async () => {
  process.env.BOT_OWNER_IDS = "staff-1"; // bypass la permission moderation.clear pour isoler le test sur le parsing de cible

  await casAsync("usage normal (mention en args[0]) fonctionne toujours", async () => {
    const msg = fakeClearMessage(REAL_ID);
    await moderationHandlers.clear(null, msg, [`<@${REAL_ID}>`, "10"]);
    const refused = msg._replies.some((r) => r.embeds?.[0]?.data?.description?.includes("Indique un membre"));
    assert.strictEqual(refused, false);
  });

  await casAsync('"clear sanctions @membre" ne supprime aucun message', async () => {
    // La cible doit être le PREMIER argument : "sanctions" n'en étant pas une,
    // la commande sort sans rien faire. Elle sort aussi SANS RIEN DIRE, parce
    // que "&clear <autre chose>" est la syntaxe du CrowBot sur ce préfixe
    // partagé — d'où la vérification sur l'absence de suppression plutôt que
    // sur un message d'erreur.
    const msg = fakeClearMessage(REAL_ID);
    let fetches = 0;
    msg.channel.messages.fetch = async () => {
      fetches++;
      return new Collection();
    };
    await moderationHandlers.clear(null, msg, ["sanctions", `<@${REAL_ID}>`]);
    assert.strictEqual(fetches, 0, "aucun message ne doit même être cherché");
    assert.deepStrictEqual(msg._replies, [], "et rien n'est répondu à la place du CrowBot");
  });

  // Remis à sa valeur d'origine : le bloc &clear ci-dessus l'a changé en
  // "staff-1" et ne le restaure jamais, ce qui aurait fait échouer &baninfo
  // ci-dessous (owner-1 n'aurait plus été reconnu comme propriétaire).
  process.env.BOT_OWNER_IDS = "owner-1";

  console.log("\n&baninfo — détail d'un bannissement, MÊME si la personne n'est plus sur le serveur :");

  await casAsync("affiche le dernier bannissement enregistré pour cet identifiant", async () => {
    const TARGET_ID = "222222222222222222";
    historyStore.record({
      guildId: "gban",
      action: "ban",
      targetId: TARGET_ID,
      targetTag: "parti#0001",
      moderatorId: "owner-1",
      moderatorTag: "owner#0001",
      reason: "raid",
      source: "bot",
    });
    const message = {
      member: { id: "owner-1", guild: { id: "gban" }, roles: { cache: new Collection() } },
      guild: { id: "gban" },
      reply: async (p) => (message._reply = p),
    };
    // Pas de guild.members.fetch ici : &baninfo ne doit JAMAIS en avoir besoin,
    // contrairement à &sanctions — c'est précisément ce qui le distingue.
    await moderationExtra.baninfo({}, message, [`<@${TARGET_ID}>`]);
    const texte = message._reply.embeds[0].data.description;
    assert.ok(texte.includes("raid"), texte);
    assert.ok(texte.includes("owner#0001"), texte);
  });

  await casAsync("aucun bannissement enregistré pour cet identifiant : message clair", async () => {
    const message = {
      member: { id: "owner-1", guild: { id: "gban" }, roles: { cache: new Collection() } },
      guild: { id: "gban" },
      reply: async (p) => (message._reply = p),
    };
    await moderationExtra.baninfo({}, message, ["<@333333333333333333>"]);
    assert.ok(message._reply.embeds[0].data.description.includes("Aucun bannissement"));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
