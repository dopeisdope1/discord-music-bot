/**
 * Vérifie la hiérarchie de modération (utils/moderation/actions.js) et
 * l'historique centralisé (utils/moderationHistoryStore.js) — en particulier
 * le correctif d'attribution du relais d'audit log (utils/moderationLog.js) :
 * Discord journalise les actions REST d'un bot sous SON compte à lui, jamais
 * sous celui de la personne qui a tapé la commande. Sans ce correctif, une
 * action de CE bot se serait retrouvée doublée dans l'historique — une fois
 * via utils/moderation/actions.js (bon modérateur), une fois via le relais
 * (mauvais modérateur : le bot lui-même).
 *
 * DATA_DIR pointe vers un dossier temporaire créé pour ce process.
 *
 * Lancement : node scripts/test-moderation.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { AuditLogEvent, Collection } = require("discord.js");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mod-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const accessStore = require("../utils/accessStore");
const historyStore = require("../utils/moderationHistoryStore");
const { checkHierarchy } = require("../utils/moderation/actions");
const { relayAuditLogEntry } = require("../utils/moderationLog");

const GUILD_ID = "guild-1";
const BOT_ID = "bot-1";

function fakeGuild({ ownerId = "server-owner" } = {}) {
  return { id: GUILD_ID, ownerId, members: { me: { id: BOT_ID, roles: { highest: { position: 10 } } } } };
}
const fakeMember = ({ id, position }) => ({ id, roles: { highest: { position } } });

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

async function main() {
  console.log("Hiérarchie de modération :");

  cas("un modérateur ne peut pas sanctionner un membre de rôle supérieur", () => {
    const guild = fakeGuild();
    const refusal = checkHierarchy(guild, fakeMember({ id: "mod-1", position: 5 }), fakeMember({ id: "target-1", position: 8 }));
    assert.match(refusal, /supérieur ou égal/);
  });

  cas("un modérateur ne peut pas sanctionner un membre de rôle égal", () => {
    const guild = fakeGuild();
    const refusal = checkHierarchy(guild, fakeMember({ id: "mod-1", position: 5 }), fakeMember({ id: "target-1", position: 5 }));
    assert.match(refusal, /supérieur ou égal/);
  });

  cas("un modérateur peut sanctionner un membre de rôle inférieur", () => {
    const guild = fakeGuild();
    const refusal = checkHierarchy(guild, fakeMember({ id: "mod-1", position: 8 }), fakeMember({ id: "target-1", position: 5 }));
    assert.strictEqual(refusal, null);
  });

  cas("le propriétaire du serveur passe outre la hiérarchie de rôle (mais pas celle du bot)", () => {
    const guild = fakeGuild({ ownerId: "server-owner" }); // bot en position 10
    // Propriétaire en position 1, cible en position 5 : sans le bypass,
    // l'ACTEUR (1) serait refusé face à la cible (5) — le bypass lève
    // spécifiquement cette règle-là, pas celle du bot (target < bot ici).
    const refusal = checkHierarchy(guild, fakeMember({ id: "server-owner", position: 1 }), fakeMember({ id: "target-1", position: 5 }));
    assert.strictEqual(refusal, null);
  });

  cas("un membre ne peut pas s'auto-sanctionner", () => {
    const guild = fakeGuild();
    const actor = fakeMember({ id: "mod-1", position: 8 });
    assert.match(checkHierarchy(guild, actor, actor), /toi-même/);
  });

  cas("un membre de rang sys reste protégé même par un rôle plus haut", () => {
    accessStore.add("sys", "protected-1");
    const guild = fakeGuild();
    const refusal = checkHierarchy(guild, fakeMember({ id: "mod-1", position: 20 }), fakeMember({ id: "protected-1", position: 1 }));
    assert.match(refusal, /rang sys/);
  });

  cas("le bot refuse d'agir s'il n'a pas un rôle assez haut", () => {
    const guild = fakeGuild(); // bot en position 10
    const refusal = checkHierarchy(guild, fakeMember({ id: "mod-1", position: 30 }), fakeMember({ id: "target-1", position: 15 }));
    assert.match(refusal, /Mon rôle est trop bas/);
  });

  console.log("\nHistorique de modération :");

  cas("une entrée enregistrée se retrouve par cible et par modérateur, pas par un autre", () => {
    historyStore.record({
      guildId: GUILD_ID,
      action: "kick",
      targetId: "t1",
      targetTag: "Cible#0001",
      moderatorId: "m1",
      moderatorTag: "Mod#0001",
      source: "bot",
    });
    assert.strictEqual(historyStore.search(GUILD_ID, { targetId: "t1" }).length, 1);
    assert.strictEqual(historyStore.search(GUILD_ID, { moderatorId: "m1" }).length, 1);
    assert.strictEqual(historyStore.search(GUILD_ID, { moderatorId: "quelqu-un-dautre" }).length, 0);
  });

  cas("l'historique n'est jamais mélangé entre serveurs", () => {
    historyStore.record({ guildId: "autre-serveur", action: "kick", targetId: "t1", moderatorId: "m1", source: "bot" });
    assert.strictEqual(historyStore.search(GUILD_ID, { targetId: "t1" }).length, 1, "toujours 1 : l'entrée de l'autre serveur ne doit pas compter");
  });

  console.log("\nRelais d'audit log — pas de double comptage :");

  await casAsync("une action DE CE BOT n'est pas relayée (déjà journalisée avec le vrai modérateur ailleurs)", async () => {
    const before = historyStore.search(GUILD_ID, {}, {}).length;
    const client = { user: { id: BOT_ID }, guilds: { cache: new Collection() } };
    const entry = {
      action: AuditLogEvent.MemberBanAdd,
      executorId: BOT_ID,
      executor: { tag: "Bot#0000" },
      targetId: "t2",
      target: { tag: "Cible#0002" },
      reason: null,
      changes: [],
    };
    await relayAuditLogEntry(client, { id: GUILD_ID }, entry);
    const after = historyStore.search(GUILD_ID, { limit: 0 }).length;
    assert.strictEqual(after, historyStore.search(GUILD_ID, { limit: 0 }).length);
    assert.ok(!historyStore.search(GUILD_ID, { targetId: "t2", limit: 0 }).length, "aucune entrée ajoutée pour une action du bot lui-même");
  });

  await casAsync("une action d'un AUTRE exécuteur (CrowBot, modérateur humain) est bien enregistrée", async () => {
    const client = { user: { id: BOT_ID }, guilds: { cache: new Collection() } };
    const entry = {
      action: AuditLogEvent.MemberKick,
      executorId: "other-bot-999",
      executor: { tag: "CrowBot#0001" },
      targetId: "t3",
      target: { tag: "Cible#0003" },
      reason: "test",
      changes: [],
    };
    await relayAuditLogEntry(client, { id: GUILD_ID }, entry);
    const results = historyStore.search(GUILD_ID, { targetId: "t3", limit: 0 });
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].moderatorId, "other-bot-999");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
}

main();
