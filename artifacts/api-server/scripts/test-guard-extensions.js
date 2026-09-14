/**
 * Vérifie les ajouts à l'anti-nuke : ping d'un rôle en plus du log
 * (utils/moderationLog.js, utils/guard/config.js), seuil de création de
 * compte (utils/guard/definitions.js::checkNewAccount), vidage en un coup
 * de la whitelist (utils/guard/whitelist.js::clearAll), et les nouvelles
 * sous-commandes &antinuke ping/creationlimit/clearwl/wluser
 * (utils/serverAdminCommands.js).
 *
 * Lancement : node scripts/test-guard-extensions.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "guardext-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const permStore = require("../utils/permissions/store");
const guardConfig = require("../utils/guard/config");
const guardWhitelist = require("../utils/guard/whitelist");
const { checkNewAccount } = require("../utils/guard/definitions");
const { postModerationEntry } = require("../utils/moderationLog");
const { setLogChannelId } = require("../utils/modLogStore");
const serverAdmin = require("../utils/serverAdminCommands");

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

function fakeMember(id, { createdTimestamp, kicked = { value: false } } = {}) {
  return {
    id,
    user: { id, tag: `${id}#0000`, createdTimestamp },
    guild: null, // rempli par fakeGuild
    roles: { cache: new Collection(), highest: { position: 1 } },
    kick: async function () { kicked.value = true; },
    ban: async function () { this.wasBanned = true; },
    timeout: async function (ms) { this.timedOutMs = ms; },
  };
}

function fakeGuild(id, member) {
  const guild = {
    id,
    name: "Serveur test",
    ownerId: "server-owner",
    members: { me: { id: "bot-1", roles: { highest: { position: 50 } } }, cache: new Collection([[member.id, member]]) },
  };
  member.guild = guild;
  return guild;
}

const ROLE = "role-guard-ext";
permStore.setRoleGrants("g-cmd", ROLE, ["protection.guard.manage"]);

function fakeMessage({ mentionRole = null, mentionUser = null } = {}) {
  const replies = [];
  const roleCache = new Collection([[ROLE, { id: ROLE }]]);
  return {
    content: "&antinuke",
    author: { id: "staff-1" },
    member: { id: "staff-1", guild: { id: "g-cmd" }, roles: { cache: roleCache }, permissions: new PermissionsBitField() },
    guild: { id: "g-cmd" },
    mentions: {
      roles: new Collection(mentionRole ? [[mentionRole.id, mentionRole]] : []),
      users: new Collection(mentionUser ? [[mentionUser.id, mentionUser]] : []),
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
  console.log("utils/guard/config.js — ping et seuil de création :");

  await cas("valeurs par défaut : pas de ping, seuil désactivé", () => {
    const config = guardConfig.getConfig("g-default");
    assert.strictEqual(config.pingRoleId, null);
    assert.strictEqual(config.creationLimitMs, 0);
  });

  await cas("setPingRole/setCreationLimit persistent", () => {
    guardConfig.setPingRole("g-cfg", "role-staff");
    guardConfig.setCreationLimit("g-cfg", 7 * 86400000);
    const config = guardConfig.getConfig("g-cfg");
    assert.strictEqual(config.pingRoleId, "role-staff");
    assert.strictEqual(config.creationLimitMs, 7 * 86400000);
  });

  await cas("setPingRole(null) désactive, setCreationLimit(0) désactive", () => {
    guardConfig.setPingRole("g-cfg", null);
    guardConfig.setCreationLimit("g-cfg", 0);
    const config = guardConfig.getConfig("g-cfg");
    assert.strictEqual(config.pingRoleId, null);
    assert.strictEqual(config.creationLimitMs, 0);
  });

  console.log("\nutils/guard/whitelist.js — clearAll :");

  await cas("vide utilisateurs ET rôles, renvoie le nombre retiré", () => {
    guardWhitelist.add("g-wl", "users", "u1");
    guardWhitelist.add("g-wl", "users", "u2");
    guardWhitelist.add("g-wl", "roles", "r1");
    const count = guardWhitelist.clearAll("g-wl");
    assert.strictEqual(count, 3);
    assert.deepStrictEqual(guardWhitelist.getWhitelist("g-wl"), { users: [], roles: [] });
  });

  await cas("sur une whitelist déjà vide, renvoie 0 sans planter", () => {
    assert.strictEqual(guardWhitelist.clearAll("g-wl-vide"), 0);
  });

  console.log("\nutils/moderationLog.js — pingRoleId sur postModerationEntry :");

  await cas("avec pingRoleId, le message ping le rôle ET autorise ce ping précis", async () => {
    const sent = [];
    const logChannel = { id: "lc1", isTextBased: () => true, send: async (p) => { sent.push(p); return {}; } };
    const guild = { id: "g-ping1", channels: { cache: new Collection([["lc1", logChannel]]) } };
    const client = { user: { id: "bot-1" }, guilds: { cache: new Collection([["g-ping1", guild]]) } };
    setLogChannelId("g-ping1", "moderation", "lc1");
    await postModerationEntry(client, "g-ping1", "moderation", {
      title: "Test",
      fields: [{ label: "X", value: "Y" }],
      pingRoleId: "role-staff",
    });
    assert.strictEqual(sent[0].content, "<@&role-staff>");
    assert.deepStrictEqual(sent[0].allowedMentions, { roles: ["role-staff"] });
  });

  await cas("sans pingRoleId, aucun contenu ping et aucune mention autorisée (comportement d'avant)", async () => {
    const sent = [];
    const logChannel = { id: "lc2", isTextBased: () => true, send: async (p) => { sent.push(p); return {}; } };
    const guild = { id: "g-ping2", channels: { cache: new Collection([["lc2", logChannel]]) } };
    const client = { user: { id: "bot-1" }, guilds: { cache: new Collection([["g-ping2", guild]]) } };
    setLogChannelId("g-ping2", "moderation", "lc2");
    await postModerationEntry(client, "g-ping2", "moderation", { title: "Test", fields: [{ label: "X", value: "Y" }] });
    assert.strictEqual(sent[0].content, undefined);
    assert.deepStrictEqual(sent[0].allowedMentions, { parse: [] });
  });

  console.log("\nutils/guard/definitions.js — checkNewAccount :");

  const client = { user: { id: "bot-1" } };

  await cas("un compte plus jeune que le seuil est sanctionné", async () => {
    const kicked = { value: false };
    const member = fakeMember("young-1", { createdTimestamp: Date.now() - 1000, kicked });
    fakeGuild("g-new1", member);
    guardConfig.setEnabled("g-new1", true);
    guardConfig.setCreationLimit("g-new1", 7 * 86400000); // 7 jours
    guardConfig.setPunishment("g-new1", "kick");
    await checkNewAccount(client, member);
    assert.strictEqual(kicked.value, true);
  });

  await cas("un compte plus vieux que le seuil n'est pas sanctionné", async () => {
    const kicked = { value: false };
    const member = fakeMember("old-1", { createdTimestamp: Date.now() - 30 * 86400000, kicked });
    fakeGuild("g-new2", member);
    guardConfig.setEnabled("g-new2", true);
    guardConfig.setCreationLimit("g-new2", 7 * 86400000);
    guardConfig.setPunishment("g-new2", "kick");
    await checkNewAccount(client, member);
    assert.strictEqual(kicked.value, false);
  });

  await cas("seuil désactivé (0) : personne n'est jamais sanctionné, même un compte tout neuf", async () => {
    const kicked = { value: false };
    const member = fakeMember("young-2", { createdTimestamp: Date.now(), kicked });
    fakeGuild("g-new3", member);
    guardConfig.setEnabled("g-new3", true);
    guardConfig.setCreationLimit("g-new3", 0);
    await checkNewAccount(client, member);
    assert.strictEqual(kicked.value, false);
  });

  await cas("un membre whitelisté échappe même avec un compte tout neuf", async () => {
    const kicked = { value: false };
    const member = fakeMember("young-3", { createdTimestamp: Date.now(), kicked });
    fakeGuild("g-new4", member);
    guardConfig.setEnabled("g-new4", true);
    guardConfig.setCreationLimit("g-new4", 7 * 86400000);
    guardWhitelist.add("g-new4", "users", "young-3");
    await checkNewAccount(client, member);
    assert.strictEqual(kicked.value, false);
  });

  console.log("\n&antinuke ping/creationlimit/clearwl/wluser :");

  await cas("antinuke ping @rôle règle le rôle pingé", async () => {
    const role = { id: "r-ping", name: "Staff" };
    await serverAdmin.antinuke(null, fakeMessage({ mentionRole: role }), ["ping"]);
    assert.strictEqual(guardConfig.getConfig("g-cmd").pingRoleId, "r-ping");
  });

  await cas("antinuke ping off désactive", async () => {
    await serverAdmin.antinuke(null, fakeMessage(), ["ping", "off"]);
    assert.strictEqual(guardConfig.getConfig("g-cmd").pingRoleId, null);
  });

  await cas("antinuke ping sans rôle ni off explique quoi faire, ne plante pas", async () => {
    const msg = fakeMessage();
    await serverAdmin.antinuke(null, msg, ["ping"]);
    assert.ok(texte(msg).includes("Indique un rôle"), texte(msg));
  });

  await cas("antinuke creationlimit 7d règle le seuil", async () => {
    await serverAdmin.antinuke(null, fakeMessage(), ["creationlimit", "7d"]);
    assert.strictEqual(guardConfig.getConfig("g-cmd").creationLimitMs, 7 * 86400000);
  });

  await cas("antinuke creationlimit off désactive", async () => {
    await serverAdmin.antinuke(null, fakeMessage(), ["creationlimit", "off"]);
    assert.strictEqual(guardConfig.getConfig("g-cmd").creationLimitMs, 0);
  });

  await cas("antinuke creationlimit avec une durée invalide explique quoi faire", async () => {
    const msg = fakeMessage();
    await serverAdmin.antinuke(null, msg, ["creationlimit", "n'importe quoi"]);
    assert.ok(texte(msg).includes("durée"), texte(msg));
  });

  await cas("antinuke wluser @membre ajoute puis retire (bascule)", async () => {
    const user = { id: "u-toggle" };
    await serverAdmin.antinuke(null, fakeMessage({ mentionUser: user }), ["wluser"]);
    assert.ok(guardWhitelist.getWhitelist("g-cmd").users.includes("u-toggle"));
    await serverAdmin.antinuke(null, fakeMessage({ mentionUser: user }), ["wluser"]);
    assert.ok(!guardWhitelist.getWhitelist("g-cmd").users.includes("u-toggle"));
  });

  await cas("antinuke clearwl vide tout et le dit", async () => {
    guardWhitelist.add("g-cmd", "users", "u-a");
    guardWhitelist.add("g-cmd", "roles", "r-a");
    const msg = fakeMessage();
    await serverAdmin.antinuke(null, msg, ["clearwl"]);
    assert.deepStrictEqual(guardWhitelist.getWhitelist("g-cmd"), { users: [], roles: [] });
    assert.ok(texte(msg).includes("vidée"), texte(msg));
  });

  await cas("antinuke clearwl sur une whitelist déjà vide le dit aussi", async () => {
    const msg = fakeMessage();
    await serverAdmin.antinuke(null, msg, ["clearwl"]);
    assert.ok(texte(msg).includes("déjà vide"), texte(msg));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
