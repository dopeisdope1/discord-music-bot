/**
 * Vérifie les extensions "Gestion du serveur" câblées à un vrai backend :
 * &choose, &create (émoji), &temprole/&untemprole (utils/tempRoleStore.js),
 * &autoreact (utils/autoReactStore.js), &end giveaway.
 *
 * Lancement : node scripts/test-server-extra.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "serverextra-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const tempRoleStore = require("../utils/tempRoleStore");
const autoReactStore = require("../utils/autoReactStore");
const serverExtra = require("../utils/serverExtra");
const giveawayStore = require("../utils/giveawayStore");
const { endGiveaway } = require("../utils/giveaways");

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

console.log("tempRoleStore :");

cas("un rôle temporaire expiré est retrouvé puis retiré", () => {
  tempRoleStore.add("g1", "u1", "r1", Date.now() - 1000);
  assert.ok(tempRoleStore.getExpired().some((e) => e.guildId === "g1" && e.userId === "u1" && e.roleId === "r1"));
  tempRoleStore.remove("g1", "u1", "r1");
  assert.ok(!tempRoleStore.getExpired().some((e) => e.userId === "u1"));
});

console.log("\nautoReactStore :");

cas("ajouter/retirer un émoji fonctionne dans les deux sens", () => {
  assert.strictEqual(autoReactStore.add("c1", "👍"), true);
  assert.strictEqual(autoReactStore.add("c1", "👍"), false); // déjà présent
  assert.deepStrictEqual(autoReactStore.getForChannel("c1"), ["👍"]);
  assert.strictEqual(autoReactStore.remove("c1", "👍"), true);
  assert.deepStrictEqual(autoReactStore.getForChannel("c1"), []);
});

console.log("\n&choose :");

(async () => {
  await casAsync("choisit toujours parmi les options données", async () => {
    const message = {
      member: { id: "owner-1", guild: { id: "g1" }, roles: { cache: new Collection() } },
      reply: async (p) => (message._reply = p),
    };
    await serverExtra.choose(null, message, ["pizza,,burger,,sushi"]);
    const text = message._reply.embeds[0].data.description;
    assert.ok(["pizza", "burger", "sushi"].some((opt) => text.includes(opt)));
  });

  await casAsync("refuse avec moins de 2 options", async () => {
    const message = {
      member: { id: "owner-1", guild: { id: "g1" }, roles: { cache: new Collection() } },
      reply: async (p) => (message._reply = p),
    };
    await serverExtra.choose(null, message, ["pizza"]);
    assert.ok(message._reply.embeds[0].data.description.includes("2 options"));
  });

  await casAsync("&choose exige server.tools.use — silencieux sans la permission", async () => {
    const message = {
      member: { id: "membre-sans-droits", guild: { id: "g1" }, roles: { cache: new Collection() } },
      reply: async (p) => (message._reply = p),
    };
    await serverExtra.choose(null, message, ["pizza,,burger"]);
    assert.strictEqual(message._reply, undefined, "aucune réponse sans server.tools.use");
  });

  console.log("\n&end giveaway :");

  await casAsync("termine un giveaway actif avant son échéance et empêche un second tirage", async () => {
    giveawayStore.create({ messageId: "gm1", guildId: "g5", channelId: "c5", prize: "Nitro", endsAt: Date.now() + 60_000, hostId: "host-1" });
    giveawayStore.toggleParticipant("gm1", "user-1");

    const sentMessages = new Map();
    const client = {
      user: { id: "bot-1", tag: "bot#0000" },
      channels: {
        cache: new Collection([
          [
            "c5",
            {
              isTextBased: () => true,
              messages: { fetch: async (id) => sentMessages.get(id) || null },
              send: async () => {},
            },
          ],
        ]),
      },
    };
    sentMessages.set("gm1", { edit: async () => {} });

    const message = {
      author: { id: "owner-1", tag: "owner#0001" },
      member: { id: "owner-1", guild: { id: "g5" }, roles: { cache: new Collection() } },
      guild: { id: "g5" },
      channel: { id: "c5" },
      reply: async (p) => (message._reply = p),
    };
    await endGiveaway(client, message, ["gm1"]);
    assert.strictEqual(giveawayStore.get("gm1").ended, true);

    const message2 = { ...message, reply: async (p) => (message2._reply = p) };
    await endGiveaway(client, message2, ["gm1"]);
    assert.ok(message2._reply.embeds[0].data.description.includes("déjà terminé"));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
