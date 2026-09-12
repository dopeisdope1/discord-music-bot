/**
 * Vérifie que &addrole/&delrole (utils/moderationCommands.js) et les
 * commandes &role .../&channel ... (utils/serverAdminCommands.js) acceptent
 * un IDENTIFIANT brut en plus d'une mention — règle du cahier des charges :
 * "les paramètres peuvent être des noms, des mentions, ou des IDs". Ce
 * comportement manquait sur &addrole/&delrole (signalé explicitement) et
 * partageait la même lacune sur &role et &channel — corrigé partout.
 *
 * Lancement : node scripts/test-role-membership.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "rolemembership-test-"));
process.env.BOT_OWNER_IDS = "staff-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { moderationHandlers } = require("../utils/moderationCommands");
const serverAdmin = require("../utils/serverAdminCommands");

const MEMBER_ID = "111111111111111111";
const ROLE_ID = "222222222222222222";

function makeGuild({ memberHasRole = false } = {}) {
  const roleObj = { id: ROLE_ID, name: "Testeur", position: 2 };
  const memberRoleCache = new Collection(memberHasRole ? [[ROLE_ID, roleObj]] : []);
  const targetMember = {
    id: MEMBER_ID,
    user: { tag: "cible#0001" },
    roles: {
      cache: memberRoleCache,
      highest: { position: 1 },
      add: async function (r) {
        this._added = r.id;
      },
      remove: async function (r) {
        this._removed = r.id;
      },
    },
  };
  const guild = {
    id: "g1",
    ownerId: "owner-x",
    roles: { cache: new Collection([[ROLE_ID, roleObj]]) },
    members: {
      me: { permissions: new PermissionsBitField(PermissionsBitField.All), roles: { highest: { position: 10 } } },
      fetch: async (id) => (id === MEMBER_ID ? targetMember : null),
    },
  };
  return { guild, targetMember, roleObj };
}

function makeMessage(guild, { mentionedMember = null, mentionedRole = null } = {}) {
  const replies = [];
  return {
    author: { id: "staff-1", tag: "staff#0001" },
    member: {
      id: "staff-1",
      guild,
      roles: { cache: new Collection(), highest: { position: 5 } },
      permissions: new PermissionsBitField(PermissionsBitField.All),
    },
    guild,
    channel: { id: "c1" },
    mentions: {
      members: new Collection(mentionedMember ? [[mentionedMember.id, mentionedMember]] : []),
      roles: new Collection(mentionedRole ? [[mentionedRole.id, mentionedRole]] : []),
    },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

let reussis = 0;
async function cas(nom, fn) {
  try {
    await fn();
    reussis++;
    console.log(`  ok — ${nom}`);
  } catch (err) {
    console.error(`  ÉCHEC — ${nom}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

(async () => {
  console.log("&addrole / &delrole — mention OU ID :");

  await cas("addrole avec deux IDs bruts (membre puis rôle)", async () => {
    const { guild, targetMember } = makeGuild();
    const msg = makeMessage(guild);
    await moderationHandlers.addrole(null, msg, [MEMBER_ID, ROLE_ID]);
    assert.strictEqual(targetMember.roles._added, ROLE_ID);
  });

  await cas("addrole avec deux IDs bruts, ordre inversé (rôle puis membre)", async () => {
    const { guild, targetMember } = makeGuild();
    const msg = makeMessage(guild);
    await moderationHandlers.addrole(null, msg, [ROLE_ID, MEMBER_ID]);
    assert.strictEqual(targetMember.roles._added, ROLE_ID);
  });

  await cas("delrole avec deux IDs bruts (le membre a déjà le rôle)", async () => {
    const { guild, targetMember } = makeGuild({ memberHasRole: true });
    const msg = makeMessage(guild);
    await moderationHandlers.delrole(null, msg, [ROLE_ID, MEMBER_ID]);
    assert.strictEqual(targetMember.roles._removed, ROLE_ID);
  });

  await cas("addrole avec mention de membre + ID de rôle (mixte)", async () => {
    const { guild, targetMember, roleObj } = makeGuild();
    const msg = makeMessage(guild, { mentionedMember: targetMember });
    await moderationHandlers.addrole(null, msg, [ROLE_ID]);
    assert.strictEqual(targetMember.roles._added, roleObj.id);
  });

  await cas("échec propre sans membre ni rôle valides (ni mention ni ID)", async () => {
    const { guild } = makeGuild();
    const msg = makeMessage(guild);
    await moderationHandlers.addrole(null, msg, ["pasunidmaisunmot"]);
    assert.ok(msg._replies[0]?.embeds?.[0]?.data?.description?.includes("mention ou ID"));
  });

  await cas('s\'ajouter un rôle à SOI-MÊME est autorisé — checkHierarchy vise kick/ban/timeout, pas addrole', async () => {
    // Bug réel signalé : "&addrole @soi-même" répondait "Tu ne peux pas agir
    // sur toi-même", une règle pensée pour les actions qui NUISENT à la
    // cible (kick/ban/timeout), pas pour un ajout de rôle bénin — déjà
    // protégé par la hiérarchie sur le RÔLE lui-même (voir plus bas).
    const { guild, roleObj } = makeGuild();
    const soi = {
      id: "staff-1",
      user: { tag: "staff#0001" },
      roles: {
        cache: new Collection(),
        highest: { position: 5 },
        add: async function (r) {
          this._added = r.id;
        },
      },
    };
    guild.members.fetch = async (id) => (id === "staff-1" ? soi : null);
    const msg = makeMessage(guild, { mentionedMember: soi });
    await moderationHandlers.addrole(null, msg, [ROLE_ID]);
    assert.strictEqual(soi.roles._added, roleObj.id, JSON.stringify(msg._replies));
  });

  console.log("\n&role ... — mention OU ID :");

  await cas("role rename avec un ID brut au lieu d'une mention", async () => {
    const { guild, roleObj } = makeGuild();
    roleObj.setName = async function (n) {
      this.name = n;
    };
    roleObj.position = 2;
    guild.members.me.roles.highest.position = 10;
    const msg = makeMessage(guild);
    msg.member.permissions = new PermissionsBitField(PermissionsBitField.All);
    await serverAdmin.roleAdmin(null, msg, ["rename", ROLE_ID, "NouveauNom"]);
    assert.strictEqual(roleObj.name, "NouveauNom");
  });

  console.log("\n&channel ... — mention OU ID :");

  await cas("channel topic avec un ID brut au lieu d'une mention", async () => {
    const chanObj = { id: "333333333333333333", name: "general", setTopic: async function (t) { this.topic = t; } };
    const guild = {
      id: "g1",
      channels: { cache: new Collection([[chanObj.id, chanObj]]) },
      members: { me: { permissions: new PermissionsBitField(PermissionsBitField.All) } },
    };
    const msg = {
      author: { id: "staff-1", tag: "staff#0001" },
      member: { id: "staff-1", guild, permissions: new PermissionsBitField(PermissionsBitField.All) },
      guild,
      channel: chanObj,
      mentions: { channels: new Collection() },
      reply: async () => ({}),
    };
    await serverAdmin.channelAdmin(null, msg, ["topic", chanObj.id, "Nouveau", "topic"]);
    assert.strictEqual(chanObj.topic, "Nouveau topic");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
