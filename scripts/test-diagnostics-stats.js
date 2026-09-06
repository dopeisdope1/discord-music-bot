/**
 * Vérifie &stats history (utils/statsStore.js) et &status
 * (utils/statusDiagnostic.js).
 *
 * Lancement : node scripts/test-diagnostics-stats.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "diagstats-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const statsStore = require("../utils/statsStore");
const { utilityHandlers } = require("../utils/utilityCommands");
const { status } = require("../utils/statusDiagnostic");

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

(async () => {
  console.log("statsStore — compteurs journaliers :");

  await cas("record incrémente le bon jour, la bonne mesure, sans toucher aux autres", () => {
    statsStore.record("gs1", "messages");
    statsStore.record("gs1", "messages");
    statsStore.record("gs1", "joins");
    const [today] = statsStore.getRange("gs1", 1);
    assert.strictEqual(today.messages, 2);
    assert.strictEqual(today.joins, 1);
    assert.strictEqual(today.leaves, 0);
  });

  await cas("getRange renvoie exactement N jours, du plus ancien au plus récent, jours vides à 0", () => {
    const range = statsStore.getRange("gs2", 5);
    assert.strictEqual(range.length, 5);
    for (const day of range) assert.deepStrictEqual([day.messages, day.joins, day.leaves], [0, 0, 0]);
    const dates = range.map((d) => d.date);
    assert.deepStrictEqual([...dates].sort(), dates, "doit déjà être trié du plus ancien au plus récent");
    assert.strictEqual(dates[dates.length - 1], new Date().toISOString().slice(0, 10), "le dernier jour doit être aujourd'hui");
  });

  await cas("deux serveurs ne partagent aucun compteur", () => {
    statsStore.record("gs3", "leaves");
    const [today3] = statsStore.getRange("gs3", 1);
    const [today4] = statsStore.getRange("gs4", 1);
    assert.strictEqual(today3.leaves, 1);
    assert.strictEqual(today4.leaves, 0);
  });

  await cas("flush() n'échoue pas même sans rien à écrire (aucun appel à record entre-temps)", () => {
    statsStore.flush();
    statsStore.flush();
  });

  console.log("\n&stats history :");

  function makeStatsMessage(guildId) {
    const replies = [];
    return {
      member: { id: "owner-1", guild: { id: guildId }, roles: { cache: new Collection() }, permissions: new PermissionsBitField(PermissionsBitField.All) },
      guild: { id: guildId },
      reply: async (p) => {
        replies.push(p);
        return {};
      },
      _replies: replies,
    };
  }

  await cas("&stats history affiche 7 jours par défaut", async () => {
    const msg = makeStatsMessage("gs5");
    await utilityHandlers.statsHistory(null, msg, []);
    const desc = msg._replies[0].embeds[0].data.description;
    assert.strictEqual(desc.split("\n").length, 7);
  });

  await cas("&stats history <n> respecte le nombre demandé, plafonné à 30", async () => {
    const msg1 = makeStatsMessage("gs6");
    await utilityHandlers.statsHistory(null, msg1, ["3"]);
    assert.strictEqual(msg1._replies[0].embeds[0].data.description.split("\n").length, 3);

    const msg2 = makeStatsMessage("gs6");
    await utilityHandlers.statsHistory(null, msg2, ["9999"]);
    assert.strictEqual(msg2._replies[0].embeds[0].data.description.split("\n").length, 30);
  });

  await cas("&stats history reflète les vrais compteurs enregistrés aujourd'hui", async () => {
    statsStore.record("gs7", "messages");
    statsStore.record("gs7", "messages");
    statsStore.record("gs7", "messages");
    const msg = makeStatsMessage("gs7");
    await utilityHandlers.statsHistory(null, msg, ["1"]);
    assert.ok(msg._replies[0].embeds[0].data.description.includes("💬 3"));
  });

  console.log("\n&status :");

  function makeClient({ pingMs = 42, guildCount = 3, nodes = [] } = {}) {
    return {
      uptime: 3 * 3600_000 + 5 * 60_000,
      ws: { ping: pingMs },
      guilds: { cache: new Collection(Array.from({ length: guildCount }, (_, i) => [`g${i}`, {}])) },
      kazagumo: { shoukaku: { nodes: new Map(nodes.map((n) => [n.name, n])) } },
    };
  }

  await cas("&status réservé au rang sys — muet pour qui ne l'est pas", async () => {
    const client = makeClient();
    const replies = [];
    const msg = { author: { id: "not-owner" }, reply: async (p) => { replies.push(p); return {}; } };
    await status(client, msg);
    assert.strictEqual(replies.length, 0);
  });

  await cas("&status affiche uptime/latence/serveurs/versions pour le rang sys", async () => {
    const client = makeClient({ pingMs: 37, guildCount: 5 });
    const replies = [];
    const msg = { author: { id: "owner-1" }, reply: async (p) => { replies.push(p); return {}; } };
    await status(client, msg);
    const fields = replies[0].embeds[0].data.fields;
    const byName = Object.fromEntries(fields.map((f) => [f.name, f.value]));
    assert.strictEqual(byName["Latence gateway"], "37ms");
    assert.strictEqual(byName["Serveurs"], "5");
    assert.ok(byName["Uptime"].includes("3h"));
    assert.ok(byName["Node.js"].startsWith("v"));
  });

  await cas("&status montre l'état RÉEL de chaque nœud Lavalink (connecté vs hors ligne)", async () => {
    const { Constants } = require("shoukaku");
    const CONNECTED = Constants.State.CONNECTED;
    const DISCONNECTED = CONNECTED === 0 ? 1 : 0;
    const client = makeClient({ nodes: [{ name: "prive", state: CONNECTED }, { name: "public-1", state: DISCONNECTED }] });
    const replies = [];
    const msg = { author: { id: "owner-1" }, reply: async (p) => { replies.push(p); return {}; } };
    await status(client, msg);
    const lavalinkField = replies[0].embeds[0].data.fields.find((f) => f.name === "Lavalink");
    assert.ok(lavalinkField.value.includes("prive") && lavalinkField.value.includes("🟢"));
    assert.ok(lavalinkField.value.includes("public-1") && lavalinkField.value.includes("🔴"));
  });

  await cas("&status sans aucun nœud déclaré ne plante pas", async () => {
    const client = makeClient({ nodes: [] });
    const replies = [];
    const msg = { author: { id: "owner-1" }, reply: async (p) => { replies.push(p); return {}; } };
    await status(client, msg);
    assert.ok(replies[0].embeds[0].data.fields.find((f) => f.name === "Lavalink").value.length > 0);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
