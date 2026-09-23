/**
 * Vérifie &security scan (utils/securityScan.js) — permissions dangereuses,
 * @everyone/bots Administrator, logs, rôle de mute. L'anti-nuke/AutoMod ont
 * migré vers le bot Secure : leur audit ne fait plus partie de ce scan
 * (voir aussi scripts/test-security-panel.js sur l'ancien bot, désormais
 * côté Secure).
 *
 * Lancement : node scripts/test-security-phase5.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "security-phase5-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField, PermissionFlagsBits } = require("discord.js");
const { setLogChannelId } = require("../utils/modLogStore");
const muteStore = require("../utils/muteStore");
const { securityScan } = require("../utils/securityScan");

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

function makeRole(id, { everyone = false, admin = false, managed = false } = {}) {
  const perms = admin ? new PermissionsBitField([PermissionFlagsBits.Administrator]) : new PermissionsBitField([]);
  return { id, name: everyone ? "@everyone" : `role-${id}`, managed, permissions: perms };
}

function makeGuild(guildId, { everyoneAdmin = false, extraAdminRoles = [], bots = [] } = {}) {
  const everyone = makeRole(guildId, { everyone: true });
  if (everyoneAdmin) everyone.permissions = new PermissionsBitField([PermissionFlagsBits.Administrator]);
  const roles = new Collection([[guildId, everyone], ...extraAdminRoles.map((r) => [r.id, r])]);
  const memberEntries = bots.map((b) => [
    b.id,
    { id: b.id, user: { bot: true, tag: `${b.id}#0000` }, permissions: b.admin ? new PermissionsBitField([PermissionFlagsBits.Administrator]) : new PermissionsBitField([]) },
  ]);
  const membersCache = new Collection(memberEntries);
  return {
    id: guildId,
    roles: { everyone, cache: roles },
    members: { cache: membersCache, fetch: async () => membersCache },
  };
}

function makeSecurityMessage(guild) {
  const replies = [];
  return {
    member: { id: "owner-1", guild, roles: { cache: new Collection() }, permissions: new PermissionsBitField(PermissionsBitField.All) },
    guild,
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

(async () => {
  console.log("&security scan :");

  await cas("un serveur \"propre\" (logs + rôle de mute configurés) ne remonte aucun problème critique ni avertissement", async () => {
    const guildId = "gsec1";
    setLogChannelId(guildId, "moderation", "c1");
    muteStore.setMuteRoleId(guildId, "role-mute");
    const guild = makeGuild(guildId, {});
    guild.roles.cache.set("role-mute", makeRole("role-mute"));
    const msg = makeSecurityMessage(guild);
    await securityScan(null, msg);
    const desc = msg._replies[0].embeds[0].data.description;
    assert.ok(desc.includes("🟢"));
    assert.ok(!desc.includes("🔴 Critique"));
    assert.ok(!desc.includes("🟠 Avertissements"));
  });

  await cas("@everyone avec Administrator est un problème CRITIQUE", async () => {
    const guildId = "gsec2";
    const guild = makeGuild(guildId, { everyoneAdmin: true });
    const msg = makeSecurityMessage(guild);
    await securityScan(null, msg);
    const desc = msg._replies[0].embeds[0].data.description;
    assert.ok(desc.includes("🔴 Critique"));
    assert.ok(desc.includes("@everyone possède"));
  });

  await cas("un rôle non géré avec Administrator est un AVERTISSEMENT, pas critique", async () => {
    const guildId = "gsec3";
    const adminRole = makeRole("role-admin1", { admin: true });
    const guild = makeGuild(guildId, { extraAdminRoles: [adminRole] });
    const msg = makeSecurityMessage(guild);
    await securityScan(null, msg);
    const desc = msg._replies[0].embeds[0].data.description;
    assert.ok(!desc.includes("🔴 Critique"), "un simple rôle admin n'est pas aussi grave que @everyone admin");
    assert.ok(desc.includes("Administrator") && desc.includes("role-role-admin1"));
  });

  await cas("un rôle GÉRÉ (intégration/bot) avec Administrator n'est pas compté", async () => {
    const guildId = "gsec4";
    const managedAdmin = makeRole("role-managed", { admin: true, managed: true });
    const guild = makeGuild(guildId, { extraAdminRoles: [managedAdmin] });
    const msg = makeSecurityMessage(guild);
    await securityScan(null, msg);
    const desc = msg._replies[0].embeds[0].data.description;
    assert.ok(desc.includes("Aucun rôle (hors intégrations) n'a Administrator"));
  });

  await cas("un bot avec Administrator est signalé", async () => {
    const guildId = "gsec5";
    const guild = makeGuild(guildId, { bots: [{ id: "bot-admin-1", admin: true }] });
    const msg = makeSecurityMessage(guild);
    await securityScan(null, msg);
    const desc = msg._replies[0].embeds[0].data.description;
    assert.ok(desc.includes("bot(s) ont Administrator"));
  });

  await cas("aucun log + aucun rôle de mute = 2 avertissements distincts", async () => {
    const guildId = "gsec6";
    const guild = makeGuild(guildId, {});
    const msg = makeSecurityMessage(guild);
    await securityScan(null, msg);
    const desc = msg._replies[0].embeds[0].data.description;
    assert.ok(desc.includes("Aucun salon de logs configuré"));
    assert.ok(desc.includes("Aucun rôle de mute configuré"));
  });

  await cas("un rôle de mute configuré mais supprimé du serveur est signalé distinctement", async () => {
    const guildId = "gsec7";
    muteStore.setMuteRoleId(guildId, "role-disparu");
    const guild = makeGuild(guildId, {});
    const msg = makeSecurityMessage(guild);
    await securityScan(null, msg);
    assert.ok(msg._replies[0].embeds[0].data.description.includes("n'existe plus sur le serveur"));
  });

  await cas("&security scan est muet sans la permission server.security.scan", async () => {
    const guildId = "gsec8";
    const guild = makeGuild(guildId, {});
    const msg = makeSecurityMessage(guild);
    msg.member.id = "quidam"; // ni owner ni sys, aucun octroi
    await securityScan(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
