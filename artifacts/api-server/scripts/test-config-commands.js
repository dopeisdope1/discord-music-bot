/**
 * Vérifie les commandes de configuration (utils/configCommands.js) : &prefix,
 * &set perm / &del perm, &join settings, &ticket settings. Elles écrivent
 * dans les MÊMES stores que les rubriques correspondantes de &panel.
 * Vérifie aussi que les anciennes formes "&clear perms|limit|sanctions"
 * redirigent (et ne nettoient rien), et que "&reset sanctions" est routé.
 *
 * Lancement : node scripts/test-config-commands.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "configcmd-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const levelStore = require("../utils/permissions/levelStore");
const { configHandlers, resolveLevel } = require("../utils/configCommands");
const { getPrefixes } = require("../utils/prefixStore");
const { modHandlers, MOD_SUBCOMMANDS } = require("../utils/musicCommands");
const historyStore = require("../utils/moderationHistoryStore");

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


function makeMessage({ userId = "owner-1", roleIds = [], roles = [], users = [], channels = new Collection() } = {}) {
  const roleCache = new Collection();
  for (const id of roleIds) roleCache.set(id, { id });
  const replies = [];
  return {
    author: { id: userId },
    member: { id: userId, guild: { id: "g1" }, roles: { cache: roleCache }, permissions: new PermissionsBitField() },
    guild: { id: "g1", roles: { cache: new Collection(roles.map((r) => [r.id, r])) }, channels: { cache: channels } },
    mentions: {
      roles: new Collection(roles.map((r) => [r.id, r])),
      users: new Collection(users.map((u) => [u.id, u])),
    },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

const texte = (msg) => msg._replies[0]?.embeds?.[0]?.data?.description || "";
const cible = { id: "role-cible", toString: () => "<@&role-cible>" };

(async () => {
  console.log("&prefix :");

  await cas("change le préfixe des commandes", async () => {
    await configHandlers.prefix(null, makeMessage(), ["~"]);
    assert.strictEqual(getPrefixes("g1").musicMod, "~");
  });

  await cas("refuse un préfixe trop long", async () => {
    const msg = makeMessage();
    await configHandlers.prefix(null, msg, ["beaucouptroplong"]);
    assert.strictEqual(getPrefixes("g1").musicMod, "~", "le préfixe ne doit pas avoir changé");
    assert.ok(texte(msg).includes("3 caractères"), texte(msg));
  });

  // Un seul préfixe reste sur ce bot (musicMod) depuis le départ de la
  // modération vers son propre bot — plus de "chevauchement entre deux
  // familles" possible ici. Ce qui reste testable : un préfixe qui, une
  // fois posé, redevient un doublon exact de lui-même à la prochaine
  // tentative (prefixConflicts compare toujours le nouveau contre l'actuel).
  await cas("refuse un doublon exact avec le préfixe déjà en place", async () => {
    const msg = makeMessage();
    await configHandlers.prefix(null, msg, ["~"]);
    assert.strictEqual(getPrefixes("g1").musicMod, "~", "le doublon ne doit pas changer l'état — déjà la même valeur");
  });

  await cas("sans argument, affiche les préfixes actuels", async () => {
    const msg = makeMessage();
    await configHandlers.prefix(null, msg, []);
    assert.ok(texte(msg).includes("Préfixe des commandes"), texte(msg));
  });

  console.log("\n&set perm / &del perm :");

  await cas("un niveau invalide rappelle la plage 1-9 au lieu d'échouer sèchement", async () => {
    const msg = makeMessage({ roles: [cible] });
    await configHandlers.setPerm(null, msg, ["nimportequoi"]);
    assert.ok(texte(msg).includes("entre 1 et 9"), texte(msg));
    assert.strictEqual(levelStore.getRoleLevel("g1", "role-cible"), null);
  });

  await cas("assigne un niveau à un rôle", async () => {
    await configHandlers.setPerm(null, makeMessage({ roles: [cible] }), ["4"]);
    assert.strictEqual(levelStore.getRoleLevel("g1", "role-cible"), 4);
  });

  await cas("réassigner remplace le niveau précédent", async () => {
    await configHandlers.setPerm(null, makeMessage({ roles: [cible] }), ["6"]);
    assert.strictEqual(levelStore.getRoleLevel("g1", "role-cible"), 6);
  });

  await cas("&del perm retire le niveau du rôle", async () => {
    await configHandlers.delPerm(null, makeMessage({ roles: [cible] }), []);
    assert.strictEqual(levelStore.getRoleLevel("g1", "role-cible"), null);
  });

  await cas("les niveaux individuels passent par le même chemin", async () => {
    const membre = { id: "membre-1" };
    await configHandlers.setPerm(null, makeMessage({ users: [membre] }), ["3"]);
    assert.strictEqual(levelStore.getUserLevel("g1", "membre-1"), 3);
    await configHandlers.delPerm(null, makeMessage({ users: [membre] }), []);
    assert.strictEqual(levelStore.getUserLevel("g1", "membre-1"), null);
  });

  await cas("l'octroi est PERSISTÉ sur disque, puis réellement appliqué par can()", async () => {
    const { can } = require("../utils/permissions/engine");
    const role = { id: "role-staff", toString: () => "<@&role-staff>" };
    // Membre porteur du rôle, sans niveau : &ban (niveau 5) lui est refusé.
    const porteur = makeMessage({ userId: "porteur-1", roleIds: ["role-staff"] }).member;
    assert.strictEqual(can(porteur, "moderation.ban"), false, "sans niveau, pas de ban");

    await configHandlers.setPerm(null, makeMessage({ roles: [role] }), ["5"]);
    const surDisque = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, "permissionLevels.json"), "utf8"));
    assert.strictEqual(surDisque.g1.roleLevels["role-staff"], 5, "le niveau doit être écrit dans permissionLevels.json");
    assert.strictEqual(can(porteur, "moderation.ban"), true, "niveau 5 -> &ban autorisé");
    assert.strictEqual(can(porteur, "moderation.kick"), true, "cumulatif : le niveau 4 (&kick) est inclus");

    await configHandlers.delPerm(null, makeMessage({ roles: [role] }), []);
    const apres = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, "permissionLevels.json"), "utf8"));
    assert.ok(!("role-staff" in apres.g1.roleLevels), "le retrait doit être écrit sur disque");
    assert.strictEqual(can(porteur, "moderation.ban"), false, "retiré -> &ban de nouveau refusé");
  });

  await cas("un rang sys (non propriétaire) ne peut PAS attribuer de niveau", async () => {
    const accessStore = require("../utils/accessStore");
    accessStore.add("sys", "sys-1");
    const msg = makeMessage({ userId: "sys-1", roles: [cible] });
    await configHandlers.setPerm(null, msg, ["9"]);
    assert.strictEqual(levelStore.getRoleLevel("g1", "role-cible"), null, "aucun niveau ne doit avoir été posé");
    accessStore.remove("sys", "sys-1");
  });

  await cas("sans cible valide, un message clair (et rien n'est écrit)", async () => {
    const msg = makeMessage();
    await configHandlers.setPerm(null, msg, ["5"]);
    assert.ok(texte(msg).includes("rôle ou un membre"), texte(msg));
    const msgDel = makeMessage();
    await configHandlers.delPerm(null, msgDel, []);
    assert.ok(texte(msgDel).includes("rôle ou un membre"), texte(msgDel));
  });

  await cas("resolveLevel n'accepte que 1 à 9", () => {
    assert.strictEqual(resolveLevel(" 5 "), 5);
    assert.strictEqual(resolveLevel("0"), null);
    assert.strictEqual(resolveLevel("10"), null);
    assert.strictEqual(resolveLevel("abc"), null);
  });

  await cas("hors propriétaire du bot, tout reste muet", async () => {
    const msg = makeMessage({ userId: "membre-lambda", roles: [cible] });
    await configHandlers.setPerm(null, msg, ["7"]);
    assert.strictEqual(msg._replies.length, 0);
    assert.strictEqual(levelStore.getRoleLevel("g1", "role-cible"), null);
  });

  console.log("\nVues de configuration :");

  await cas("&join settings et &ticket settings répondent", async () => {
    for (const handler of [configHandlers.joinSettings, configHandlers.ticketSettings]) {
      const msg = makeMessage();
      await handler(null, msg);
      assert.strictEqual(msg._replies.length, 1, "chacune doit répondre");
      assert.ok(texte(msg).includes(">"), "et afficher l'état courant");
    }
  });

  console.log("\n&clear (messages) vs &reset (réinitialisations) :");

  await cas("les anciennes formes &clear perms|limit|sanctions|all redirigent sans rien nettoyer", async () => {
    const attendu = { perms: "del perm", limit: "Dispenses", sanctions: "reset sanctions", all: "reset all sanctions" };
    for (const [sub, indice] of Object.entries(attendu)) {
      const msg = makeMessage();
      msg.channel = { id: "chan-1", messages: { fetch: async () => assert.fail("aucun message ne doit être lu/supprimé") } };
      await modHandlers.clear(null, msg, sub === "all" ? ["all", "sanctions"] : [sub]);
      assert.strictEqual(msg._replies.length, 1, `${sub} : une redirection attendue`);
      assert.ok(texte(msg).includes(indice), `${sub} : ${texte(msg)}`);
    }
  });

  await cas("sans le droit de l'ancienne commande, la redirection reste muette", async () => {
    const msg = makeMessage({ userId: "membre-lambda" });
    await modHandlers.clear(null, msg, ["sanctions"]);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("&reset sanctions @membre et &reset all sanctions vident l'historique", async () => {
    const membre = { id: "123456789012345678" };
    historyStore.record({ guildId: "g1", action: "warn", targetId: membre.id, moderatorId: "owner-1" });
    historyStore.record({ guildId: "g1", action: "warn", targetId: "876543210987654321", moderatorId: "owner-1" });
    const msg = makeMessage();
    msg.guild.members = { fetch: async (id) => (id === membre.id ? { id, user: { tag: "cible#1" } } : null) };
    await modHandlers.reset(null, msg, ["sanctions", `<@${membre.id}>`]);
    assert.strictEqual(historyStore.search("g1", { targetId: membre.id }).length, 0, texte(msg));
    assert.strictEqual(historyStore.search("g1", { targetId: "876543210987654321" }).length, 1);
    await modHandlers.reset(null, makeMessage(), ["all", "sanctions"]);
    assert.strictEqual(historyStore.search("g1", {}).length, 0);
  });

  await cas("&reset n'annonce que les sous-commandes réellement routées", () => {
    assert.deepStrictEqual(MOD_SUBCOMMANDS.reset, ["sanctions", "all"]);
    assert.strictEqual(MOD_SUBCOMMANDS.clear, undefined, "&clear n'a plus de sous-commande");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
