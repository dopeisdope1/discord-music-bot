/**
 * Vérifie qu'un membre rang sys peut désormais agir/attribuer des rôles sans
 * être bloqué par la hiérarchie de RÔLE DISCORD (utils/moderation/actions.js
 * ::checkHierarchy, utils/moderationCommands.js::roleMembership) — le rang
 * sys donne déjà un accès total à toutes les commandes (utils/permissions/
 * engine.js::can), la hiérarchie Discord ne doit pas le freiner en plus.
 * "&limitrole" (utils/roleLimitStore.js), lui, reste un garde-fou actif même
 * pour un sys : ce n'est pas une question de hiérarchie mais de places
 * limitées sur le rôle.
 *
 * Lancement : node scripts/test-sys-role-hierarchy.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sys-role-hierarchy-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const accessStore = require("../utils/accessStore");
const { checkHierarchy } = require("../utils/moderation/actions");
const { moderationHandlers } = require("../utils/moderationCommands");
const permStore = require("../utils/permissions/store");
const roleLimitStore = require("../utils/roleLimitStore");

accessStore.add("sys", "sys-1");

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

function embedText(payload) {
  return payload?.embeds?.[0]?.data?.description || "";
}

function fakeGuild() {
  return { id: "g1", ownerId: "server-owner", members: { me: { id: "bot-1", roles: { highest: { position: 20 } } } } };
}

function fakeGuildAndMembers({ limite } = {}) {
  const ROLE_ID = "role-haut";
  const roleHaut = { id: ROLE_ID, name: "Haut", position: 10, members: { size: limite ? 1 : 0 }, toString: () => `<@&${ROLE_ID}>` };
  const botRole = { id: "bot-role", position: 20 };
  const guild = {
    id: `gaddrole-${Math.random().toString(36).slice(2)}`,
    ownerId: "server-owner",
    roles: { cache: new Collection([[ROLE_ID, roleHaut]]) },
    members: {
      me: { id: "bot-1", roles: { highest: botRole }, permissions: new PermissionsBitField([PermissionsBitField.Flags.ManageRoles]) },
      fetch: async (id) => (id === "target-1" ? target : null),
    },
  };
  if (limite != null) roleLimitStore.setLimit(guild.id, ROLE_ID, limite);
  const target = {
    id: "target-1",
    user: { tag: "target#0001" },
    guild,
    roles: { cache: new Collection(), highest: { position: 0 }, add: async () => {}, remove: async () => {} },
  };
  return { guild, target, roleHaut };
}

(async () => {
  console.log("utils/moderation/actions.js::checkHierarchy :");

  await cas("un sys contourne la hiérarchie de rôle Discord comme acteur (même rôle bas)", () => {
    const guild = fakeGuild();
    const roleBas = { position: 1 };
    const roleHaut = { position: 10 };
    const sys = { id: "sys-1", roles: { highest: roleBas } };
    const target = { id: "target-1", roles: { highest: roleHaut } };
    const refusal = checkHierarchy(guild, sys, target);
    assert.strictEqual(refusal, null, "un sys ne doit jamais être bloqué par la hiérarchie de rôle Discord");
  });

  await cas("un membre ordinaire reste bloqué par la hiérarchie de rôle Discord", () => {
    const guild = fakeGuild();
    const roleBas = { position: 1 };
    const roleHaut = { position: 10 };
    const modo = { id: "modo-1", roles: { highest: roleBas } };
    const target = { id: "target-1", roles: { highest: roleHaut } };
    const refusal = checkHierarchy(guild, modo, target);
    assert.ok(refusal, "un membre ordinaire doit rester bloqué");
  });

  await cas("deux sys ne peuvent toujours pas s'agir l'un l'autre (protection de la CIBLE, inchangée)", () => {
    accessStore.add("sys", "sys-2");
    const guild = fakeGuild();
    const sys1 = { id: "sys-1", roles: { highest: { position: 1 } } };
    const sys2 = { id: "sys-2", roles: { highest: { position: 1 } } };
    const refusal = checkHierarchy(guild, sys1, sys2);
    assert.ok(refusal?.includes("rang sys"), refusal);
  });

  console.log("\nutils/moderationCommands.js::roleMembership (&addrole) :");

  await cas("un sys sans rôle Discord élevé peut attribuer un rôle plus haut que le sien", async () => {
    const { guild, target } = fakeGuildAndMembers();
    permStore.grantToUser(guild.id, "sys-1", "members.role");
    const sysMember = { id: "sys-1", user: { tag: "sys#0001" }, guild, roles: { cache: new Collection(), highest: { position: 1 } }, permissions: { has: () => false } };
    const message = {
      guild, member: sysMember, author: sysMember.user, channel: { id: "chan-1" },
      mentions: { members: new Collection([["target-1", target]]), roles: new Collection([["role-haut", guild.roles.cache.get("role-haut")]]) },
      reply: async (p) => { message._reply = p; },
    };
    await moderationHandlers.addrole(null, message, ["target-1", "role-haut"]);
    assert.ok(message._reply?.files?.length, "doit produire une carte de succès (image), pas un refus");
  });

  await cas("un membre ordinaire sans rôle Discord élevé reste refusé pour le même rôle", async () => {
    const { guild, target } = fakeGuildAndMembers();
    permStore.grantToUser(guild.id, "modo-1", "members.role");
    const modoMember = { id: "modo-1", user: { tag: "modo#0001" }, guild, roles: { cache: new Collection(), highest: { position: 1 } }, permissions: { has: () => false } };
    const message = {
      guild, member: modoMember, author: modoMember.user, channel: { id: "chan-1" },
      mentions: { members: new Collection([["target-1", target]]), roles: new Collection([["role-haut", guild.roles.cache.get("role-haut")]]) },
      reply: async (p) => { message._reply = p; },
    };
    await moderationHandlers.addrole(null, message, ["target-1", "role-haut"]);
    assert.ok(embedText(message._reply).includes("supérieur ou égal"), embedText(message._reply));
  });

  await cas("&limitrole bloque un sys tout comme n'importe qui — pas une question de hiérarchie", async () => {
    const { guild, target } = fakeGuildAndMembers({ limite: 1 });
    permStore.grantToUser(guild.id, "sys-1", "members.role");
    const sysMember = { id: "sys-1", user: { tag: "sys#0001" }, guild, roles: { cache: new Collection(), highest: { position: 1 } }, permissions: { has: () => false } };
    const message = {
      guild, member: sysMember, author: sysMember.user, channel: { id: "chan-1" },
      mentions: { members: new Collection([["target-1", target]]), roles: new Collection([["role-haut", guild.roles.cache.get("role-haut")]]) },
      reply: async (p) => { message._reply = p; },
    };
    await moderationHandlers.addrole(null, message, ["target-1", "role-haut"]);
    assert.ok(embedText(message._reply).includes("déjà plein"), embedText(message._reply));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? ", des échecs sont survenus." : ", tout est vert."}`);
})();
