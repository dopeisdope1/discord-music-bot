/**
 * Vérifie &antispam et &spam (utils/automodCommands.js) : réglage du seuil de
 * déclenchement et exemption de salons, sur le même store que
 * &panel > Protection (utils/automod/antiSpam.js).
 *
 * Lancement : node scripts/test-antispam-commands.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "antispam-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const permStore = require("../utils/permissions/store");
const { automodHandlers } = require("../utils/automodCommands");
const antiSpam = require("../utils/automod/antiSpam");

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

const ROLE = "role-automod";
permStore.setRoleGrants("g1", ROLE, ["protection.automod"]);

function makeMessage({ roleId = ROLE, userId = "staff-1", channelId = "c-ici", mentionChannel = null } = {}) {
  const roles = new Collection();
  if (roleId) roles.set(roleId, { id: roleId });
  const channel = { id: channelId, toString: () => `<#${channelId}>` };
  const replies = [];
  return {
    author: { id: userId },
    member: { id: userId, guild: { id: "g1" }, roles: { cache: roles }, permissions: new PermissionsBitField() },
    guild: { id: "g1" },
    channel,
    mentions: { channels: new Collection(mentionChannel ? [[mentionChannel.id, mentionChannel]] : []) },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

const texte = (msg) => msg._replies[0]?.embeds?.[0]?.data?.description || "";

(async () => {
  console.log("&antispam — activation et seuil :");

  await cas("`on` / `off` bascule l'anti-spam", async () => {
    await automodHandlers.antispam(null, makeMessage(), ["on"]);
    assert.strictEqual(antiSpam.getConfig("g1").enabled, true);
    await automodHandlers.antispam(null, makeMessage(), ["off"]);
    assert.strictEqual(antiSpam.getConfig("g1").enabled, false);
  });

  await cas("`5/10` règle 5 messages en 10 secondes", async () => {
    await automodHandlers.antispam(null, makeMessage(), ["5/10"]);
    const config = antiSpam.getConfig("g1");
    assert.strictEqual(config.maxMessages, 5);
    assert.strictEqual(config.windowSeconds, 10);
  });

  await cas("le seuil est accepté même écrit avec des espaces", async () => {
    await automodHandlers.antispam(null, makeMessage(), ["8", "/", "20"]);
    assert.strictEqual(antiSpam.getConfig("g1").maxMessages, 8);
  });

  await cas("un seuil absurde est refusé au lieu de rendre le salon insanctionnable", async () => {
    const avant = antiSpam.getConfig("g1").maxMessages;
    const msg = makeMessage();
    await automodHandlers.antispam(null, msg, ["1/10"]);
    assert.strictEqual(antiSpam.getConfig("g1").maxMessages, avant, "1 message ne doit pas être accepté");
    assert.ok(texte(msg).includes("hors bornes"), texte(msg));

    const msg2 = makeMessage();
    await automodHandlers.antispam(null, msg2, ["5/999"]);
    assert.ok(texte(msg2).includes("hors bornes"), "une fenêtre de 999s n'est plus du flood");
  });

  await cas("régler un seuil sans avoir activé l'anti-spam le signale", async () => {
    antiSpam.setEnabled("g1", false);
    const msg = makeMessage();
    await automodHandlers.antispam(null, msg, ["6/6"]);
    assert.ok(texte(msg).includes("désactivé"), texte(msg));
  });

  await cas("sans argument, affiche l'état, le seuil et les exemptions", async () => {
    const msg = makeMessage();
    await automodHandlers.antispam(null, msg, []);
    const body = texte(msg);
    assert.ok(body.includes("Seuil"), body);
    assert.ok(body.includes("6 messages en 6s"), body);
  });

  console.log("\n&spam — exemption par salon :");

  await cas("`allow` exempte le salon courant", async () => {
    await automodHandlers.spam(null, makeMessage({ channelId: "c-flood" }), ["allow"]);
    assert.deepStrictEqual(antiSpam.getExemptChannels("g1"), ["c-flood"]);
  });

  await cas("`deny` et `reset` remettent le salon sous surveillance", async () => {
    await automodHandlers.spam(null, makeMessage({ channelId: "c-flood" }), ["deny"]);
    assert.deepStrictEqual(antiSpam.getExemptChannels("g1"), []);
    await automodHandlers.spam(null, makeMessage({ channelId: "c-flood" }), ["allow"]);
    await automodHandlers.spam(null, makeMessage({ channelId: "c-flood" }), ["reset"]);
    assert.deepStrictEqual(antiSpam.getExemptChannels("g1"), []);
  });

  await cas("un salon mentionné l'emporte sur le salon courant", async () => {
    const autre = { id: "c-autre", toString: () => "<#c-autre>" };
    await automodHandlers.spam(null, makeMessage({ channelId: "c-ici", mentionChannel: autre }), ["allow"]);
    assert.deepStrictEqual(antiSpam.getExemptChannels("g1"), ["c-autre"]);
  });

  await cas("un mot-clé inconnu est refusé au lieu d'agir au hasard", async () => {
    const msg = makeMessage();
    await automodHandlers.spam(null, msg, ["nimportequoi"]);
    assert.ok(texte(msg).includes("allow/deny/reset"), texte(msg));
  });

  console.log("\nEffet réel sur la surveillance :");

  await cas("un salon exempté ne déclenche plus l'anti-spam", async () => {
    antiSpam.setEnabled("g1", true);
    antiSpam.setThreshold("g1", 2, 10);
    assert.ok(antiSpam.getExemptChannels("g1").includes("c-autre"));

    // 5 messages d'affilée dans le salon exempté : aucun timeout demandé.
    let sanctions = 0;
    const membre = {
      id: "spammeur",
      roles: { cache: new Collection() },
      moderatable: true,
      timeout: async () => {
        sanctions++;
      },
    };
    for (let i = 0; i < 5; i++) {
      await antiSpam.checkMessage(null, {
        author: { id: "spammeur", bot: false, tag: "s#1" },
        guild: { id: "g1" },
        member: membre,
        channel: { id: "c-autre", send: async () => {} },
        delete: async () => {},
      });
    }
    assert.strictEqual(sanctions, 0, "le salon exempté ne doit rien déclencher");
  });

  console.log("\nPermissions :");

  await cas("sans le droit protection.automod, tout reste muet", async () => {
    const avant = antiSpam.getConfig("g1").maxMessages;
    const msg = makeMessage({ roleId: null, userId: "membre-lambda" });
    await automodHandlers.antispam(null, msg, ["off"]);
    await automodHandlers.spam(null, msg, ["allow"]);
    assert.strictEqual(msg._replies.length, 0);
    assert.strictEqual(antiSpam.getConfig("g1").maxMessages, avant);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
