/**
 * Vérifie le système d'avertissements (&warn/&warnings/&unwarn) et la
 * numérotation PERMANENTE des cases (utils/caseCounterStore.js) qui
 * remplace l'ancien numéro de &sanctions/&del sanction — un simple index de
 * position recalculé à chaque appel, donc instable : ajouter une sanction
 * entre deux appels pouvait faire viser le mauvais numéro (voir le fix dans
 * utils/moderationExtra.js::delSanction).
 *
 * Lancement : node scripts/test-warn-system.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "warnsystem-test-"));
process.env.BOT_OWNER_IDS = "staff-1";

const { Collection, PermissionsBitField } = require("discord.js");
const historyStore = require("../utils/moderationHistoryStore");
const caseCounterStore = require("../utils/caseCounterStore");
const moderationExtra = require("../utils/moderationExtra");

const client = { user: { id: "bot-1" } };

// utils/moderationExtra.js::parseTarget exige un VRAI format d'ID Discord
// (15-25 chiffres) ou une mention — jamais une chaîne courte arbitraire.
const T = {}; // t1, t2... -> IDs numériques réalistes, générés une fois
for (let i = 1; i <= 9; i++) T[`t${i}`] = `10000000000000000${i}`;
T.t3b = "100000000000000031";
T.t2b = "100000000000000021";

function makeMessage(guildId, targetId) {
  const replies = [];
  const targetMember = { id: targetId, user: { id: targetId, tag: `cible-${targetId}#0001` } };
  return {
    author: { id: "staff-1", tag: "staff#0001" },
    member: {
      id: "staff-1",
      guild: { id: guildId },
      roles: { cache: new Collection() },
      permissions: new PermissionsBitField(PermissionsBitField.All),
    },
    guild: {
      id: guildId,
      members: { fetch: async (id) => (id === targetId ? targetMember : null) },
    },
    channel: { id: "c1" },
    mentions: { users: new Collection(), roles: new Collection() },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

const lastReplyText = (msg) => msg._replies.at(-1)?.embeds?.[0]?.data?.description || "";

/** Recharge utils/moderationHistoryStore.js (+ son caseCounterStore) à neuf, comme un tout nouveau process. */
function loadFreshHistoryStore(dataDir) {
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = dataDir;
  const storePath = require.resolve("../utils/moderationHistoryStore");
  const counterPath = require.resolve("../utils/caseCounterStore");
  delete require.cache[storePath];
  delete require.cache[counterPath];
  const fresh = require("../utils/moderationHistoryStore");
  fresh.search("__warmup__"); // force le chargement/la migration avant qu'on restaure la variable d'env
  process.env.DATA_DIR = previous;
  delete require.cache[storePath];
  delete require.cache[counterPath];
  return fresh;
}

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
  console.log("&warn / &warnings — enregistrement et filtrage :");

  await cas("&warn enregistre une entrée action=warn avec un numéro de case", async () => {
    const msg = makeMessage("gwarn1", T.t1);
    await moderationExtra.warn(client, msg, [T.t1, "spam répété"]);
    const entries = historyStore.search("gwarn1", { targetId: T.t1, action: "warn" });
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].reason, "spam répété");
    assert.strictEqual(typeof entries[0].caseNumber, "number");
    assert.ok(lastReplyText(msg).includes("averti"));
  });

  await cas("&warn sans membre valide explique quoi taper, n'enregistre rien", async () => {
    const msg = makeMessage("gwarn1b", "introuvable");
    await moderationExtra.warn(client, msg, []);
    assert.strictEqual(historyStore.search("gwarn1b", {}).length, 0);
  });

  await cas("&warnings ne montre QUE les avertissements, jamais les autres sanctions", async () => {
    historyStore.record({ guildId: "gwarn2", targetId: T.t2, moderatorId: "m1", action: "kick" });
    await moderationExtra.warn(client, makeMessage("gwarn2", T.t2), [T.t2, "raison 1"]);
    await moderationExtra.warn(client, makeMessage("gwarn2", T.t2), [T.t2, "raison 2"]);
    const msg = makeMessage("gwarn2", T.t2);
    await moderationExtra.warnings(client, msg, [T.t2]);
    const texte = lastReplyText(msg);
    assert.ok(texte.includes("raison 1") && texte.includes("raison 2"));
    assert.ok(!texte.includes("kick"));
  });

  await cas("&warnings sans avertissement le dit clairement", async () => {
    const msg = makeMessage("gwarn2b", T.t2b);
    await moderationExtra.warnings(client, msg, [T.t2b]);
    assert.ok(lastReplyText(msg).includes("Aucun avertissement"));
  });

  console.log("\nNumérotation permanente (corrige le bug de position instable) :");

  await cas("&unwarn supprime la BONNE entrée par numéro, même après un avertissement plus récent", async () => {
    const guildId = "gwarn3";
    await moderationExtra.warn(client, makeMessage(guildId, T.t3), [T.t3, "premier avertissement"]);
    const first = historyStore.search(guildId, { targetId: T.t3, action: "warn" })[0];

    // Avec l'ancienne numérotation par position, ce DEUXIÈME avertissement
    // aurait décalé "le numéro 1" vers lui.
    await moderationExtra.warn(client, makeMessage(guildId, T.t3), [T.t3, "deuxième avertissement"]);

    await moderationExtra.unwarn(client, makeMessage(guildId, T.t3), [T.t3, String(first.caseNumber)]);

    const restants = historyStore.search(guildId, { targetId: T.t3, action: "warn" });
    assert.strictEqual(restants.length, 1);
    assert.strictEqual(restants[0].reason, "deuxième avertissement", "le PREMIER avertissement doit être celui supprimé, pas le plus récent");
  });

  await cas("&unwarn sur un numéro inexistant le dit, ne supprime rien", async () => {
    const guildId = "gwarn3b";
    await moderationExtra.warn(client, makeMessage(guildId, T.t3b), [T.t3b]);
    const msg = makeMessage(guildId, T.t3b);
    await moderationExtra.unwarn(client, msg, [T.t3b, "9999"]);
    assert.ok(lastReplyText(msg).includes("Aucun avertissement"));
    assert.strictEqual(historyStore.search(guildId, { targetId: T.t3b }).length, 1);
  });

  await cas("&case affiche le bon détail par numéro, tous types de sanction confondus", async () => {
    const guildId = "gwarn4";
    const msg = makeMessage(guildId, T.t4);
    await moderationExtra.warn(client, msg, [T.t4, "une raison précise"]);
    const entry = historyStore.search(guildId, { targetId: T.t4 })[0];
    await moderationExtra.caseView(client, msg, [String(entry.caseNumber)]);
    const texte = lastReplyText(msg);
    assert.ok(texte.includes(`Case #${entry.caseNumber}`));
    assert.ok(texte.includes("warn"));
    assert.ok(texte.includes("une raison précise"));
  });

  await cas("&case sur un numéro inexistant le dit clairement, ne plante pas", async () => {
    const msg = makeMessage("gwarn5", T.t5);
    await moderationExtra.caseView(client, msg, ["9999"]);
    assert.ok(lastReplyText(msg).length > 0);
  });

  console.log("\nCompteur de cases (utils/caseCounterStore.js) :");

  await cas("deux serveurs différents ont des compteurs indépendants", async () => {
    const before6 = caseCounterStore.getLastCaseNumber("gwarn6");
    const before7 = caseCounterStore.getLastCaseNumber("gwarn7");
    await moderationExtra.warn(client, makeMessage("gwarn6", T.t6), [T.t6]);
    assert.strictEqual(caseCounterStore.getLastCaseNumber("gwarn6"), before6 + 1);
    assert.strictEqual(caseCounterStore.getLastCaseNumber("gwarn7"), before7, "gwarn7 ne doit pas bouger");
  });

  await cas("un numéro n'est jamais réattribué après suppression de l'entrée qui le portait", async () => {
    const guildId = "gwarn8";
    await moderationExtra.warn(client, makeMessage(guildId, T.t8), [T.t8, "à supprimer"]);
    const entry = historyStore.search(guildId, { targetId: T.t8 })[0];
    historyStore.deleteById(guildId, entry.id);
    await moderationExtra.warn(client, makeMessage(guildId, T.t8), [T.t8, "nouvelle entrée"]);
    const next = historyStore.search(guildId, { targetId: T.t8 })[0];
    assert.ok(next.caseNumber > entry.caseNumber, "le compteur ne doit jamais reculer, même si l'entrée précédente a été supprimée");
  });

  console.log("\nMigration rétroactive (entrées écrites avant l'introduction du numéro de case) :");

  await cas("les anciennes entrées reçoivent un numéro rétroactif, dans l'ordre CHRONOLOGIQUE", () => {
    const guildId = "gwarn9";
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "warnsystem-migration-"));
    const older = { id: "old-1", guildId, targetId: "tA", action: "kick", createdAt: "2020-01-01T00:00:00.000Z" };
    const newer = { id: "old-2", guildId, targetId: "tA", action: "ban", createdAt: "2020-06-01T00:00:00.000Z" };
    // Volontairement dans le désordre dans le fichier : la migration doit
    // trier par date, pas se fier à l'ordre déjà présent.
    fs.writeFileSync(path.join(dataDir, "moderationHistory.json"), JSON.stringify([newer, older]));

    const fresh = loadFreshHistoryStore(dataDir);
    const byId = Object.fromEntries(fresh.search(guildId, { limit: 10 }).map((e) => [e.id, e.caseNumber]));
    assert.strictEqual(byId["old-1"], 1, "la plus ancienne doit recevoir le numéro 1");
    assert.strictEqual(byId["old-2"], 2, "la plus récente doit recevoir le numéro 2");
  });

  await cas("la migration ne retouche jamais une entrée qui a déjà un caseNumber", () => {
    const guildId = "gwarn10";
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "warnsystem-migration2-"));
    const already = { id: "keep-1", guildId, targetId: "tB", action: "ban", createdAt: "2020-01-01T00:00:00.000Z", caseNumber: 42 };
    fs.writeFileSync(path.join(dataDir, "moderationHistory.json"), JSON.stringify([already]));

    const fresh = loadFreshHistoryStore(dataDir);
    const numbers = fresh.search(guildId, { limit: 10 }).map((e) => e.caseNumber);
    assert.deepStrictEqual(numbers, [42]);
  });

  await cas("une entrée sans targetId (gestion serveur, pas une case) ne reçoit jamais de numéro", () => {
    const guildId = "gwarn11";
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "warnsystem-migration3-"));
    const roleEvent = { id: "role-1", guildId, action: "role_create", createdAt: "2020-01-01T00:00:00.000Z" }; // pas de targetId
    fs.writeFileSync(path.join(dataDir, "moderationHistory.json"), JSON.stringify([roleEvent]));

    const fresh = loadFreshHistoryStore(dataDir);
    const entry = fresh.search(guildId, { limit: 10 })[0];
    assert.strictEqual(entry.caseNumber, undefined);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
