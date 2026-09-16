/**
 * Vérifie "&promote"/"&demote"/"&gradeladder" (utils/rankLadderCommands.js,
 * utils/rankLadderStore.js) : échelle de grades ORDONNÉE et configurable,
 * séparée de "&rank" (niveaux/XP, utils/levels.js) et "&derank" (retire TOUS
 * les rôles, utils/moderationExtra.js) qui existaient déjà pour autre chose.
 *
 * Lancement : node scripts/test-grade-ladder.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "grade-ladder-test-"));
process.env.BOT_OWNER_IDS = "staff-1";

const { Collection, PermissionsBitField } = require("discord.js");
const rankLadder = require("../utils/rankLadderCommands");
const ladderStore = require("../utils/rankLadderStore");
const permStore = require("../utils/permissions/store");

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

const MEMBER_ID = "111111111111111111";
const ROLE_BAS = "222222222222222222"; // grade 0
const ROLE_MOYEN = "333333333333333333"; // grade 1
const ROLE_HAUT = "444444444444444444"; // grade 2

function fakeRole(id, name, position) {
  return { id, name, position, toString: () => `<@&${id}>` };
}

function makeGuild(memberRoleIds = []) {
  const roles = new Collection([
    [ROLE_BAS, fakeRole(ROLE_BAS, "Recrue", 1)],
    [ROLE_MOYEN, fakeRole(ROLE_MOYEN, "Confirmé", 2)],
    [ROLE_HAUT, fakeRole(ROLE_HAUT, "Vétéran", 3)],
  ]);
  const memberRoleCache = new Collection(memberRoleIds.map((id) => [id, roles.get(id)]));
  const targetMember = {
    id: MEMBER_ID,
    user: { tag: "cible#0001" },
    roles: {
      cache: memberRoleCache,
      highest: { position: memberRoleIds.length ? Math.max(...memberRoleIds.map((id) => roles.get(id).position)) : 0 },
      add: async function (r) {
        memberRoleCache.set(r.id, roles.get(r.id));
        this._added = r.id;
      },
      remove: async function (r) {
        const id = typeof r === "string" ? r : r.id;
        memberRoleCache.delete(id);
        this._removed = id;
      },
    },
  };
  const guild = {
    id: "g1",
    ownerId: "owner-x",
    roles: { cache: roles },
    members: {
      me: { permissions: new PermissionsBitField(PermissionsBitField.All), roles: { highest: { position: 10 } } },
      fetch: async (id) => (id === MEMBER_ID ? targetMember : null),
    },
  };
  return { guild, targetMember };
}

function makeMessage(guild, authorId = "staff-1") {
  const replies = [];
  return {
    author: { id: authorId, tag: `${authorId}#0001` },
    member: { id: authorId, guild, roles: { cache: new Collection(), highest: { position: 5 } }, permissions: new PermissionsBitField(PermissionsBitField.All) },
    guild,
    channel: { id: "c1" },
    mentions: { roles: new Collection() },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

const texteDe = (p) => p.embeds?.[0]?.data?.description || p.embeds?.[0]?.toJSON?.().description || "";

(async () => {
  console.log("gradeladder — configuration de l'échelle :");

  await cas("add empile au sommet, dans l'ordre d'ajout", () => {
    ladderStore.addRole("g1", ROLE_BAS);
    ladderStore.addRole("g1", ROLE_MOYEN);
    ladderStore.addRole("g1", ROLE_HAUT);
    assert.deepStrictEqual(ladderStore.getLadder("g1"), [ROLE_BAS, ROLE_MOYEN, ROLE_HAUT]);
  });

  await cas("ajouter deux fois ne duplique pas", () => {
    assert.strictEqual(ladderStore.addRole("g1", ROLE_BAS), false);
  });

  await cas("gradeladder list affiche l'échelle dans l'ordre", async () => {
    const { guild } = makeGuild();
    const msg = makeMessage(guild);
    await rankLadder.gradeLadder(null, msg, ["list"]);
    const texte = texteDe(msg._replies[0]);
    assert.ok(
      texte.indexOf(ROLE_BAS) < texte.indexOf(ROLE_MOYEN) && texte.indexOf(ROLE_MOYEN) < texte.indexOf(ROLE_HAUT),
      texte
    );
  });

  console.log("\n&promote :");

  await cas("un membre sans grade est promu directement au grade le plus bas", async () => {
    const { guild, targetMember } = makeGuild([]);
    const msg = makeMessage(guild);
    await rankLadder.promote(null, msg, [MEMBER_ID]);
    assert.strictEqual(targetMember.roles._added, ROLE_BAS);
    assert.ok(texteDe(msg._replies[0]).includes("Recrue"), texteDe(msg._replies[0]));
  });

  await cas("promouvoir retire l'ancien grade et donne le suivant", async () => {
    const { guild, targetMember } = makeGuild([ROLE_BAS]);
    const msg = makeMessage(guild);
    await rankLadder.promote(null, msg, [MEMBER_ID]);
    assert.strictEqual(targetMember.roles._removed, ROLE_BAS);
    assert.strictEqual(targetMember.roles._added, ROLE_MOYEN);
    assert.ok(!targetMember.roles.cache.has(ROLE_BAS));
    assert.ok(targetMember.roles.cache.has(ROLE_MOYEN));
  });

  await cas("déjà au grade le plus haut : le dit, ne touche à rien", async () => {
    const { guild, targetMember } = makeGuild([ROLE_HAUT]);
    const msg = makeMessage(guild);
    await rankLadder.promote(null, msg, [MEMBER_ID]);
    assert.strictEqual(targetMember.roles._added, undefined);
    assert.ok(texteDe(msg._replies[0]).includes("plus haut"), texteDe(msg._replies[0]));
  });

  console.log("\n&demote :");

  await cas("rétrograde vers le grade juste en dessous", async () => {
    const { guild, targetMember } = makeGuild([ROLE_HAUT]);
    const msg = makeMessage(guild);
    await rankLadder.demote(null, msg, [MEMBER_ID]);
    assert.strictEqual(targetMember.roles._removed, ROLE_HAUT);
    assert.strictEqual(targetMember.roles._added, ROLE_MOYEN);
  });

  await cas("aucun grade : le dit, ne plante pas", async () => {
    const { guild, targetMember } = makeGuild([]);
    const msg = makeMessage(guild);
    await rankLadder.demote(null, msg, [MEMBER_ID]);
    assert.strictEqual(targetMember.roles._added, undefined);
    assert.ok(texteDe(msg._replies[0]).includes("aucun grade"), texteDe(msg._replies[0]));
  });

  await cas("déjà au grade le plus bas : le dit, ne touche à rien", async () => {
    const { guild, targetMember } = makeGuild([ROLE_BAS]);
    const msg = makeMessage(guild);
    await rankLadder.demote(null, msg, [MEMBER_ID]);
    assert.strictEqual(targetMember.roles._removed, undefined);
    assert.ok(texteDe(msg._replies[0]).includes("plus bas"), texteDe(msg._replies[0]));
  });

  console.log("\nPermissions :");

  await cas("sans members.rank.manage, promote/demote/gradeladder restent muets", async () => {
    const { guild } = makeGuild([]);
    const msg = makeMessage(guild, "quidam-1");
    await rankLadder.promote(null, msg, [MEMBER_ID]);
    await rankLadder.demote(null, msg, [MEMBER_ID]);
    await rankLadder.gradeLadder(null, msg, ["list"]);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("un rôle accordé via permStore débloque aussi la commande", async () => {
    permStore.setRoleGrants("g1", "role-staff", ["members.rank.manage"]);
    const { guild } = makeGuild([]);
    const msg = makeMessage(guild, "membre-role");
    msg.member.roles.cache.set("role-staff", { id: "role-staff" });
    await rankLadder.gradeLadder(null, msg, ["list"]);
    assert.strictEqual(msg._replies.length, 1);
  });

  console.log("\nÉchelle vide :");

  await cas("promote/demote expliquent qu'il faut configurer l'échelle d'abord", async () => {
    ladderStore.removeRole("g1", ROLE_BAS);
    ladderStore.removeRole("g1", ROLE_MOYEN);
    ladderStore.removeRole("g1", ROLE_HAUT);
    const { guild } = makeGuild([]);
    const msg = makeMessage(guild);
    await rankLadder.promote(null, msg, [MEMBER_ID]);
    assert.ok(texteDe(msg._replies[0]).includes("échelle"), texteDe(msg._replies[0]));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
