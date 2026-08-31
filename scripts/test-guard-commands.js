/**
 * Vérifie les commandes texte de l'anti-nuke (utils/guardCommands.js) :
 * &antibot/&antichannel/&antiban/... règlent les MÊMES guards que
 * &panel > Anti-nuke, et &wl/&unwl la même whitelist.
 *
 * Lancement : node scripts/test-guard-commands.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "guardcmd-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const permStore = require("../utils/permissions/store");
const { guardHandlers, COMMAND_TO_GUARD, readOnOff } = require("../utils/guardCommands");
const guardConfig = require("../utils/guard/config");
const guardWhitelist = require("../utils/guard/whitelist");
const { ALL_GUARDS } = require("../utils/guard/definitions");

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

const ROLE = "role-guard";
permStore.setRoleGrants("g1", ROLE, ["protection.guard.manage"]);

function makeMessage({ content = "antibot", roleId = ROLE, userId = "staff-1", users = [], roles = [] } = {}) {
  const roleCache = new Collection();
  if (roleId) roleCache.set(roleId, { id: roleId });
  const replies = [];
  return {
    content: `&${content}`,
    author: { id: userId },
    member: { id: userId, guild: { id: "g1" }, roles: { cache: roleCache }, permissions: new PermissionsBitField() },
    guild: { id: "g1" },
    mentions: {
      users: new Collection(users.map((u) => [u.id, u])),
      roles: new Collection(roles.map((r) => [r.id, r])),
    },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

const texte = (msg) => msg._replies[0]?.embeds?.[0]?.data?.description || "";

(async () => {
  console.log("Un guard, une commande :");

  await cas("chaque guard défini a sa commande, et réciproquement", () => {
    assert.strictEqual(Object.keys(COMMAND_TO_GUARD).length, ALL_GUARDS.length);
    for (const definition of ALL_GUARDS) {
      const command = definition.key.replace(/-/g, "");
      assert.strictEqual(COMMAND_TO_GUARD[command], definition.key, `${definition.key} n'a pas de commande`);
      assert.strictEqual(typeof guardHandlers[command], "function");
    }
  });

  await cas("le tiret de `antirole-admin` devient un nom tapable", () => {
    assert.strictEqual(COMMAND_TO_GUARD.antiroleadmin, "antirole-admin");
  });

  console.log("\nActivation explicite, jamais une bascule :");

  // isGuardEnabled() répond "se déclenchera-t-il", interrupteur général
  // compris. Pour tester l'état des guards eux-mêmes, le général doit être
  // allumé — c'est aussi la seule configuration où ils servent à quelque chose.
  guardConfig.setEnabled("g1", true);

  await cas("`on` deux fois de suite laisse le guard actif", async () => {
    await guardHandlers.antibot(null, makeMessage(), ["on"]);
    assert.strictEqual(guardConfig.isGuardEnabled("g1", "antibot"), true);
    await guardHandlers.antibot(null, makeMessage(), ["on"]);
    assert.strictEqual(guardConfig.isGuardEnabled("g1", "antibot"), true, "une bascule aurait éteint le guard");
  });

  await cas("`off` désactive et n'affecte pas les autres guards", async () => {
    await guardHandlers.antiwebhook(null, makeMessage(), ["on"]);
    await guardHandlers.antibot(null, makeMessage(), ["off"]);
    assert.strictEqual(guardConfig.isGuardEnabled("g1", "antibot"), false);
    assert.strictEqual(guardConfig.isGuardEnabled("g1", "antiwebhook"), true);
  });

  await cas("`max` est accepté comme synonyme de `on`", () => {
    assert.strictEqual(readOnOff("max"), true);
    assert.strictEqual(readOnOff("on"), true);
    assert.strictEqual(readOnOff("off"), false);
    assert.strictEqual(readOnOff("nimportequoi"), null);
    assert.strictEqual(readOnOff(undefined), null);
  });

  await cas("sans argument, la commande affiche l'état et le seuil", async () => {
    const msg = makeMessage();
    await guardHandlers.antichannel(null, msg, []);
    const body = texte(msg);
    assert.ok(body.includes("Rafale de création de salons"), body);
    assert.ok(body.includes("Déclenchement"), body);
  });

  await cas("activer un guard alors que l'anti-nuke général est coupé le signale", async () => {
    guardConfig.setEnabled("g1", false);
    const msg = makeMessage();
    await guardHandlers.antiban(null, msg, ["on"]);
    assert.ok(texte(msg).includes("désactivé"), "l'avertissement doit apparaître");
    assert.ok(texte(msg).includes("antinuke on"), texte(msg));
  });

  await cas("une fois l'anti-nuke général actif, plus d'avertissement", async () => {
    guardConfig.setEnabled("g1", true);
    const msg = makeMessage();
    await guardHandlers.antiunban(null, msg, ["on"]);
    assert.ok(!texte(msg).includes("⚠️"), texte(msg));
  });

  console.log("\n&secur et &punition :");

  await cas("&secur off coupe l'interrupteur général", async () => {
    await guardHandlers.secur(null, makeMessage({ content: "secur" }), ["off"]);
    assert.strictEqual(guardConfig.getConfig("g1").enabled, false);
    await guardHandlers.secur(null, makeMessage({ content: "secur" }), ["on"]);
    assert.strictEqual(guardConfig.getConfig("g1").enabled, true);
  });

  await cas("&secur sans argument résume l'état", async () => {
    const msg = makeMessage({ content: "secur" });
    await guardHandlers.secur(null, msg, []);
    const body = texte(msg);
    assert.ok(body.includes("Guards actifs"), body);
    assert.ok(body.includes(`/ ${ALL_GUARDS.length}`), body);
  });

  await cas("&punition all ban règle la sanction", async () => {
    await guardHandlers.punition(null, makeMessage({ content: "punition" }), ["all", "ban"]);
    assert.strictEqual(guardConfig.getConfig("g1").punishment, "ban");
  });

  await cas("&punition refuse une sanction inconnue au lieu d'en inventer une", async () => {
    const msg = makeMessage({ content: "punition" });
    await guardHandlers.punition(null, msg, ["all", "derank"]);
    assert.strictEqual(guardConfig.getConfig("g1").punishment, "ban", "la sanction ne doit pas changer");
    assert.ok(texte(msg).includes("Sanction actuelle"), texte(msg));
  });

  console.log("\nWhitelist anti-nuke (&wl / &unwl) :");

  await cas("&wl @membre l'ajoute", async () => {
    await guardHandlers.wl(null, makeMessage({ content: "wl", users: [{ id: "u-1" }] }), []);
    assert.deepStrictEqual(guardWhitelist.getWhitelist("g1").users, ["u-1"]);
  });

  await cas("&wl accepte un identifiant brut, pas seulement une mention", async () => {
    await guardHandlers.wl(null, makeMessage({ content: "wl" }), ["123456789012345678"]);
    assert.ok(guardWhitelist.getWhitelist("g1").users.includes("123456789012345678"));
  });

  await cas("&wl @rôle passe bien dans la liste des rôles", async () => {
    await guardHandlers.wl(null, makeMessage({ content: "wl", roles: [{ id: "r-1", toString: () => "<@&r-1>" }] }), []);
    assert.deepStrictEqual(guardWhitelist.getWhitelist("g1").roles, ["r-1"]);
  });

  await cas("&wl sans argument affiche la liste au lieu de rien faire", async () => {
    const msg = makeMessage({ content: "wl" });
    await guardHandlers.wl(null, msg, []);
    assert.ok(texte(msg).includes("<@u-1>"), texte(msg));
  });

  await cas("&unwl retire, et le dit si la personne n'y était pas", async () => {
    await guardHandlers.unwl(null, makeMessage({ content: "unwl", users: [{ id: "u-1" }] }), []);
    assert.ok(!guardWhitelist.getWhitelist("g1").users.includes("u-1"));
    const msg = makeMessage({ content: "unwl", users: [{ id: "u-inconnu" }] });
    await guardHandlers.unwl(null, msg, []);
    assert.ok(texte(msg).includes("n'y était pas"), texte(msg));
  });

  console.log("\nPermissions :");

  await cas("sans le droit protection.guard.manage, tout reste muet", async () => {
    const avant = guardConfig.isGuardEnabled("g1", "antikick");
    const msg = makeMessage({ roleId: null, userId: "membre-lambda" });
    for (const handler of [guardHandlers.antikick, guardHandlers.secur, guardHandlers.wl, guardHandlers.punition]) {
      await handler(null, msg, ["on"]);
    }
    assert.strictEqual(msg._replies.length, 0, "aucune réponse sur un préfixe partagé");
    assert.strictEqual(guardConfig.isGuardEnabled("g1", "antikick"), avant, "et rien n'a changé");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
