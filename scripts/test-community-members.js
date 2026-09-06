/**
 * Vérifie les 3 nouvelles fonctionnalités "Communauté/Membres" :
 * - Départ (utils/leaveStore.js) — symétrique de utils/welcomeStore.js.
 * - Rôles automatiques à l'arrivée (utils/autoroleStore.js + autoroleCommands.js).
 * - Vérification (utils/verificationStore.js + utils/verification.js).
 *
 * Lancement : node scripts/test-community-members.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "community-members-test-"));
process.env.BOT_OWNER_IDS = "staff-1";

const { Collection, PermissionsBitField } = require("discord.js");
const leaveStore = require("../utils/leaveStore");
const autoroleStore = require("../utils/autoroleStore");
const { autoroleHandlers, applyAutoroles } = require("../utils/autoroleCommands");
const verificationStore = require("../utils/verificationStore");
const { setupVerification, handleVerifyButton } = require("../utils/verification");

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
console.log("leaveStore (miroir de welcomeStore) :");

await cas("config par défaut : aucun salon, 30s, aucun message", () => {
  const c = leaveStore.getConfig("gl1");
  assert.strictEqual(c.channelId, null);
  assert.strictEqual(c.autoDeleteSeconds, 30);
  assert.deepStrictEqual(c.messages, []);
});

await cas("setChannel/setAutoDelete/addMessage/removeMessage persistent indépendamment de welcomeStore", () => {
  leaveStore.setChannel("gl2", "c1");
  leaveStore.setAutoDelete("gl2", 0);
  leaveStore.addMessage("gl2", "Au revoir {user} !");
  const c = leaveStore.getConfig("gl2");
  assert.strictEqual(c.channelId, "c1");
  assert.strictEqual(c.autoDeleteSeconds, 0);
  assert.deepStrictEqual(c.messages, ["Au revoir {user} !"]);
  assert.strictEqual(leaveStore.removeMessage("gl2", 0), true);
  assert.strictEqual(leaveStore.removeMessage("gl2", 0), false);
});

await cas("pickRandomMessage renvoie null sans message configuré, sinon un des messages", () => {
  assert.strictEqual(leaveStore.pickRandomMessage("gl3"), null);
  leaveStore.addMessage("gl3", "seul message");
  assert.strictEqual(leaveStore.pickRandomMessage("gl3"), "seul message");
});

console.log("\nautoroleStore + &autorole add/del/list :");

function makeAdminMessage(guildId, mentionedRole) {
  const replies = [];
  return {
    author: { id: "staff-1", tag: "staff#0001" },
    member: { id: "staff-1", guild: { id: guildId }, roles: { cache: new Collection() }, permissions: new PermissionsBitField(PermissionsBitField.All) },
    guild: { id: guildId, roles: { cache: new Collection(mentionedRole ? [[mentionedRole.id, mentionedRole]] : []) } },
    mentions: { roles: new Collection(mentionedRole ? [[mentionedRole.id, mentionedRole]] : []) },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

await cas("&autorole add whiteliste un rôle, &autorole list le montre, &autorole del le retire", async () => {
  const role = { id: "role-1", name: "Membre", toString: () => "<@&role-1>" };
  await autoroleHandlers.add(null, makeAdminMessage("ga1", role), []);
  assert.deepStrictEqual(autoroleStore.getRoleIds("ga1"), ["role-1"]);

  const listMsg = makeAdminMessage("ga1", role);
  await autoroleHandlers.list(null, listMsg);
  assert.ok(listMsg._replies[0].embeds[0].data.description.includes("role-1"));

  await autoroleHandlers.del(null, makeAdminMessage("ga1", role), []);
  assert.deepStrictEqual(autoroleStore.getRoleIds("ga1"), []);
});

await cas("&autorole add refuse @everyone", async () => {
  const everyone = { id: "ga2", name: "@everyone", toString: () => "<@&ga2>" };
  await autoroleHandlers.add(null, makeAdminMessage("ga2", everyone), []);
  assert.deepStrictEqual(autoroleStore.getRoleIds("ga2"), []);
});

await cas("applyAutoroles donne TOUS les rôles configurés à l'arrivée, ignore ceux qui n'existent plus", async () => {
  const guildRoles = new Collection([
    ["role-a", { id: "role-a" }],
    ["role-b", { id: "role-b" }],
  ]);
  autoroleStore.setRoleIds("ga3", ["role-a", "role-b", "role-disparu"]);
  let added = null;
  const member = {
    guild: { id: "ga3", roles: { cache: guildRoles } },
    roles: {
      add: async (roles) => {
        added = roles;
      },
    },
  };
  await applyAutoroles(member);
  assert.deepStrictEqual(added, ["role-a", "role-b"]);
});

await cas("applyAutoroles ne fait rien (n'appelle pas roles.add) sans rôle configuré", async () => {
  const member = {
    guild: { id: "ga4", roles: { cache: new Collection() } },
    roles: { add: async () => assert.fail("ne doit pas être appelé") },
  };
  await applyAutoroles(member);
});

console.log("\nVérification (verificationStore + verification.js) :");

function makeVerifySetupMessage(guildId, mentionedRole) {
  const replies = [];
  return {
    author: { id: "staff-1", tag: "staff#0001" },
    member: { id: "staff-1", guild: { id: guildId }, roles: { cache: new Collection() }, permissions: new PermissionsBitField(PermissionsBitField.All) },
    guild: { id: guildId, roles: { cache: new Collection(mentionedRole ? [[mentionedRole.id, mentionedRole]] : []) } },
    mentions: { roles: new Collection(mentionedRole ? [[mentionedRole.id, mentionedRole]] : []) },
    channel: { id: "c1", send: async () => ({}) },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

await cas("&verify setup sans rôle ni configuration existante explique quoi taper", async () => {
  const msg = makeVerifySetupMessage("gv1");
  await setupVerification(null, msg, []);
  assert.ok(msg._replies[0].embeds[0].data.description.includes("Indique un rôle"));
});

await cas("&verify setup @rôle configure le rôle ET poste le bouton dans le salon courant", async () => {
  const role = { id: "role-verif", name: "Vérifié" };
  const msg = makeVerifySetupMessage("gv2", role);
  let sentPayload = null;
  msg.channel.send = async (p) => {
    sentPayload = p;
    return {};
  };
  await setupVerification(null, msg, []);
  assert.strictEqual(verificationStore.getConfig("gv2").roleId, "role-verif");
  assert.strictEqual(verificationStore.getConfig("gv2").channelId, "c1");
  const json = sentPayload.components[0].toJSON();
  const button = json.components.find((c) => c.type === 1)?.components[0];
  assert.strictEqual(button.custom_id, "verify:claim");
});

await cas("le bouton \"Se vérifier\" donne le rôle une seule fois", async () => {
  const roleId = "role-verif2";
  verificationStore.setRole("gv3", roleId);
  const cache = new Collection();
  const guild = { id: "gv3", roles: { cache: new Collection([[roleId, { id: roleId, toString: () => `<@&${roleId}>` }]]) } };
  let added = null;
  const member = {
    roles: {
      cache,
      add: async (role) => {
        added = role.id;
        cache.set(role.id, role);
      },
    },
  };
  const replies = [];
  const interaction1 = {
    customId: "verify:claim",
    guild,
    member,
    reply: async (p) => {
      replies.push(p);
      return {};
    },
  };
  await handleVerifyButton(interaction1);
  assert.strictEqual(added, roleId);
  assert.ok(replies[0].content.includes("Vérifié"));

  // Un second clic (déjà vérifié) ne doit pas planter, ni re-tenter d'ajouter le rôle.
  const interaction2 = {
    customId: "verify:claim",
    guild,
    member,
    reply: async (p) => {
      replies.push(p);
      return {};
    },
  };
  await handleVerifyButton(interaction2);
  assert.ok(replies[1].content.includes("déjà vérifié"));
});

await cas("le bouton \"Se vérifier\" sans configuration le dit clairement, ne plante pas", async () => {
  const replies = [];
  const interaction = {
    customId: "verify:claim",
    guild: { id: "gv4", roles: { cache: new Collection() } },
    member: { roles: { cache: new Collection() } },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
  };
  await handleVerifyButton(interaction);
  assert.ok(replies[0].content.includes("plus configurée"));
});

console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
