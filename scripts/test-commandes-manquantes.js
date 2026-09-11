/**
 * Vérifie trois commandes ajoutées pour compléter la liste vue sur &perms :
 * &absence set/reset (self-service, comme uo clear), &staff check (droits
 * réels d'un membre, recoupés d'un coup plutôt qu'à la main sur &perms/
 * &helpall) et &limitrole (place limitée sur un rôle, vérifiée par &addrole
 * ET &autorole).
 *
 * Lancement : node scripts/test-commandes-manquantes.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "commandes-manquantes-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { utilityHandlers } = require("../utils/utilityCommands");
const { moderationHandlers } = require("../utils/moderationCommands");
const serverAdmin = require("../utils/serverAdminCommands");
const { applyAutoroles } = require("../utils/autoroleCommands");
const autoroleStore = require("../utils/autoroleStore");
const absenceStore = require("../utils/absenceStore");
const roleLimitStore = require("../utils/roleLimitStore");
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

function fakeMessage({ author = { id: "owner-1", tag: "owner#0001" }, member, guild, mentions } = {}) {
  const replies = [];
  return {
    author,
    member: member || { id: author.id, user: author, guild, roles: { cache: new Collection() } },
    guild,
    mentions: mentions || { members: new Collection() },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

const embedText = (reply) => reply?.embeds?.[0]?.data?.description || "";

(async () => {
  console.log("&absence set/reset :");

  await cas("&absence set marque bien l'auteur absent, avec la raison donnée", async () => {
    const guild = { id: "g1" };
    const msg = fakeMessage({ author: { id: "u1", tag: "u1#0001" }, guild });
    await utilityHandlers.absence(null, msg, ["set", "vacances", "une", "semaine"]);
    assert.deepStrictEqual(absenceStore.getAbsence("g1", "u1")?.reason, "vacances une semaine");
    assert.ok(embedText(msg._replies[0]).includes("vacances une semaine"));
  });

  await cas("&absence set sans raison fonctionne quand même", async () => {
    const guild = { id: "g1" };
    const msg = fakeMessage({ author: { id: "u2", tag: "u2#0001" }, guild });
    await utilityHandlers.absence(null, msg, ["set"]);
    assert.strictEqual(absenceStore.getAbsence("g1", "u2")?.reason, null);
  });

  await cas("&absence reset lève l'absence", async () => {
    const guild = { id: "g1" };
    const msg = fakeMessage({ author: { id: "u1", tag: "u1#0001" }, guild });
    await utilityHandlers.absence(null, msg, ["reset"]);
    assert.strictEqual(absenceStore.getAbsence("g1", "u1"), null);
    assert.ok(embedText(msg._replies[0]).includes("levée"));
  });

  await cas("&absence reset sans absence en cours le dit clairement", async () => {
    const guild = { id: "g1" };
    const msg = fakeMessage({ author: { id: "u3", tag: "u3#0001" }, guild });
    await utilityHandlers.absence(null, msg, ["reset"]);
    assert.ok(embedText(msg._replies[0]).includes("n'étais pas"));
  });

  await cas("aucun ne demande de permission particulière — self-service, comme uo clear", async () => {
    const guild = { id: "g-quidam" };
    const msg = fakeMessage({ author: { id: "quidam-1", tag: "quidam#0001" }, member: { id: "quidam-1", guild, roles: { cache: new Collection() } }, guild });
    await utilityHandlers.absence(null, msg, ["set", "raison"]);
    assert.ok(absenceStore.getAbsence("g-quidam", "quidam-1"));
  });

  console.log("\n&staff check :");

  await cas("le propriétaire du bot est identifié comme tel", async () => {
    const guild = { id: "g2" };
    const target = { id: "owner-1", user: { tag: "owner#0001" }, roles: { cache: new Collection() } };
    const msg = fakeMessage({ guild, mentions: { members: new Collection([[target.id, target]]) } });
    await utilityHandlers.staffCheck(null, msg, []);
    assert.ok(embedText(msg._replies[0]).includes("propriétaire du bot"), embedText(msg._replies[0]));
  });

  await cas("un membre avec des rôles accordés voit les VRAIES commandes débloquées", async () => {
    const guild = { id: "g2" };
    permStore.setRoleGrants("g2", "role-mod", ["moderation.kick"]);
    const target = {
      id: "u-mod",
      user: { tag: "mod#0001" },
      roles: { cache: new Collection([["role-mod", { id: "role-mod" }]]) },
    };
    const msg = fakeMessage({ guild, mentions: { members: new Collection([[target.id, target]]) } });
    await utilityHandlers.staffCheck(null, msg, []);
    const texte = embedText(msg._replies[0]);
    assert.ok(texte.includes("kick"), texte);
  });

  await cas("un membre sans aucune permission accordée le dit clairement", async () => {
    const guild = { id: "g2" };
    const target = { id: "u-rien", user: { tag: "rien#0001" }, roles: { cache: new Collection() } };
    const msg = fakeMessage({ guild, mentions: { members: new Collection([[target.id, target]]) } });
    await utilityHandlers.staffCheck(null, msg, []);
    assert.ok(embedText(msg._replies[0]).includes("aucune permission"));
  });

  await cas("sans mention, vérifie l'auteur lui-même", async () => {
    const guild = { id: "g2" };
    const member = { id: "owner-1", user: { tag: "owner#0001" }, guild, roles: { cache: new Collection() } };
    const msg = fakeMessage({ guild, member, mentions: { members: new Collection() } });
    await utilityHandlers.staffCheck(null, msg, []);
    assert.ok(embedText(msg._replies[0]).includes("propriétaire"));
  });

  console.log("\n&limitrole :");

  function fakeRole(id, name, size = 0) {
    return { id, name, toString: () => `<@&${id}>`, members: { size } };
  }

  await cas("pose une limite, l'affiche ensuite correctement", async () => {
    const role = fakeRole("role-vip", "VIP", 2);
    const guild = { id: "g3", roles: { cache: new Collection([[role.id, role]]) } };
    const msg1 = fakeMessage({ guild, mentions: { members: new Collection(), roles: new Collection([[role.id, role]]) } });
    await serverAdmin.limitRole(null, msg1, [role.toString(), "5"]);
    assert.strictEqual(roleLimitStore.getLimit("g3", role.id), 5);
    assert.ok(embedText(msg1._replies[0]).includes("5"), embedText(msg1._replies[0]));

    const msg2 = fakeMessage({ guild, mentions: { members: new Collection(), roles: new Collection([[role.id, role]]) } });
    await serverAdmin.limitRole(null, msg2, [role.toString()]);
    assert.ok(embedText(msg2._replies[0]).includes("2/5"), embedText(msg2._replies[0]));
  });

  await cas('"off" retire la limite', async () => {
    const role = fakeRole("role-vip2", "VIP2", 1);
    const guild = { id: "g4", roles: { cache: new Collection([[role.id, role]]) } };
    roleLimitStore.setLimit("g4", role.id, 3);
    const msg = fakeMessage({ guild, mentions: { members: new Collection(), roles: new Collection([[role.id, role]]) } });
    await serverAdmin.limitRole(null, msg, [role.toString(), "off"]);
    assert.strictEqual(roleLimitStore.getLimit("g4", role.id), null);
  });

  await cas("&addrole refuse d'ajouter un rôle déjà plein", async () => {
    const role = fakeRole("role-plein", "Plein", 1);
    roleLimitStore.setLimit("g5", role.id, 1);
    const target = { id: "cible-1", user: { tag: "cible#0001" }, roles: { cache: new Collection(), highest: { position: 1 } } };
    const guild = {
      id: "g5",
      ownerId: "owner-1",
      roles: { cache: new Collection([[role.id, role]]) },
      members: { me: { permissions: new PermissionsBitField(PermissionsBitField.All), roles: { highest: { position: 10 } } }, fetch: async (id) => (id === target.id ? target : null) },
    };
    const msg = fakeMessage({
      guild,
      member: { id: "owner-1", guild, roles: { cache: new Collection(), highest: { position: 5 } }, permissions: new PermissionsBitField(PermissionsBitField.All) },
      mentions: { members: new Collection([[target.id, target]]), roles: new Collection([[role.id, role]]) },
    });
    await moderationHandlers.addrole(null, msg, []);
    assert.ok(embedText(msg._replies[0]).includes("plein"), embedText(msg._replies[0]));
    assert.strictEqual(target.roles._added, undefined, "le rôle ne doit pas avoir été ajouté");
  });

  console.log("\n&autorole respecte aussi &limitrole :");

  await cas("un rôle automatique déjà plein n'est PAS distribué à l'arrivée (silencieux, pas d'erreur)", async () => {
    const role = fakeRole("role-auto-plein", "AutoPlein", 2);
    roleLimitStore.setLimit("g6", role.id, 2);
    autoroleStore.addRole("g6", role.id);
    let ajoutes = null;
    const member = {
      guild: { id: "g6", roles: { cache: new Collection([[role.id, role]]) } },
      roles: { add: async (ids) => (ajoutes = ids) },
    };
    await applyAutoroles(member);
    assert.strictEqual(ajoutes, null, "aucun rôle plein ne doit être distribué");
  });

  await cas("un rôle automatique PAS plein est distribué normalement", async () => {
    const roleLibre = fakeRole("role-auto-libre", "AutoLibre", 0);
    autoroleStore.addRole("g7", roleLibre.id);
    let ajoutes = null;
    const member = {
      guild: { id: "g7", roles: { cache: new Collection([[roleLibre.id, roleLibre]]) } },
      roles: { add: async (ids) => (ajoutes = ids) },
    };
    await applyAutoroles(member);
    assert.deepStrictEqual(ajoutes, [roleLibre.id]);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
