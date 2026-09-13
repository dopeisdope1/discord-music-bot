/**
 * "!!secur" (utils/securityPanel.js) — tout ce qui concerne la sécurité DU
 * SERVEUR : résumé (propriétaires/rang sys/mutes/uptime/ping), Sécurité
 * serveur (mêmes 4 interrupteurs et magasins que &panel > Protection) et
 * Anti-nuke (mêmes magasins que &panel > Anti-nuke, utils/guard/*.js).
 *
 * Scindé de "!!panel" (strictement personnel, voir
 * utils/personalProtection.js et scripts/test-personal-protection.js) —
 * demande explicite : "une commande pour panel perso et une commande avec
 * tout les truc de securité etc".
 *
 * Lancement : node scripts/test-security-panel.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "security-panel-test-"));
process.env.BOT_OWNER_IDS = "";

const { Collection } = require("discord.js");
const securityPanel = require("../utils/securityPanel");
const permStore = require("../utils/permissions/store");
const automod = require("../utils/automod/antiSpam");
const guardConfig = require("../utils/guard/config");
const { ALL_GUARDS } = require("../utils/guard/definitions");
const accessStore = require("../utils/accessStore");
const muteStore = require("../utils/muteStore");
const { getPrefixes } = require("../utils/prefixStore");

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

function fakeMessage(content, { authorId = "u1", guildId = "g1" } = {}) {
  const replies = [];
  const channelSends = [];
  return {
    content,
    author: { id: authorId, bot: false },
    guild: { id: guildId },
    member: { id: authorId, guild: { id: guildId }, roles: { cache: new Collection() } },
    channel: { send: async (p) => channelSends.push(p) },
    reply: async (p) => replies.push(p),
    _replies: replies,
    _channelSends: channelSends,
  };
}

function fakeInteraction(customId, { userId = "u1", guildId = "g1", values, client } = {}) {
  const updates = [];
  const replies = [];
  return {
    customId,
    guild: { id: guildId },
    user: { id: userId },
    member: { id: userId, guild: { id: guildId }, roles: { cache: new Collection() } },
    values,
    client,
    update: async (p) => updates.push(p),
    reply: async (p) => replies.push(p),
    _updates: updates,
    _replies: replies,
  };
}

(async () => {
  console.log("Mot-clé et préfixe :");

  await cas('un mot inconnu après "!!" reste silencieux', async () => {
    const msg = fakeMessage("!!nimportequoi");
    await securityPanel.handleSecurityTextCommand(null, msg);
    assert.strictEqual(msg._channelSends.length, 0);
  });

  await cas('le préfixe "&" n\'est pas concerné', async () => {
    const msg = fakeMessage("&secur");
    await securityPanel.handleSecurityTextCommand(null, msg);
    assert.strictEqual(msg._channelSends.length, 0);
  });

  console.log("\n!!secur — accès :");

  await cas("sans protection.automod NI protection.guard.manage, refusé", async () => {
    const msg = fakeMessage("!!secur", { authorId: "quidam-1", guildId: "g-refus" });
    await securityPanel.handleSecurityTextCommand(null, msg);
    assert.strictEqual(msg._channelSends.length, 0);
    assert.ok(msg._replies.length > 0);
  });

  await cas("avec protection.automod SEULEMENT, le panneau s'ouvre", async () => {
    permStore.grantToUser("g-auto", "staff-1", "protection.automod");
    const msg = fakeMessage("!!secur", { authorId: "staff-1", guildId: "g-auto" });
    await securityPanel.handleSecurityTextCommand(null, msg);
    assert.strictEqual(msg._channelSends.length, 1);
  });

  await cas("avec protection.guard.manage SEULEMENT, le panneau s'ouvre", async () => {
    permStore.grantToUser("g-guard0", "staff-2", "protection.guard.manage");
    const msg = fakeMessage("!!secur", { authorId: "staff-2", guildId: "g-guard0" });
    await securityPanel.handleSecurityTextCommand(null, msg);
    assert.strictEqual(msg._channelSends.length, 1);
  });

  console.log("\n!!secur — Sécurité serveur (mêmes magasins que &panel) :");

  await cas("sans protection.automod, la rubrique est verrouillée (texte, pas de boutons)", async () => {
    permStore.grantToUser("g-lock1", "staff-3", "protection.guard.manage");
    const msg = fakeMessage("!!secur", { authorId: "staff-3", guildId: "g-lock1" });
    await securityPanel.handleSecurityTextCommand(null, msg);
    const texte = JSON.stringify(msg._channelSends[0].components);
    assert.ok(texte.includes("protection.automod"), texte);
    assert.ok(!texte.includes("secur:srv:"));
  });

  await cas("avec protection.automod, les 4 interrupteurs apparaissent", async () => {
    permStore.grantToUser("g-srv1", "staff-4", "protection.automod");
    const msg = fakeMessage("!!secur", { authorId: "staff-4", guildId: "g-srv1" });
    await securityPanel.handleSecurityTextCommand(null, msg);
    const texte = JSON.stringify(msg._channelSends[0].components);
    assert.ok(texte.includes("secur:srv:antiSpam"));
    assert.ok(texte.includes("secur:srv:antiLien"));
    assert.ok(texte.includes("secur:srv:antiMassMention"));
    assert.ok(texte.includes("secur:srv:motsInterdits"));
  });

  await cas("sans protection.automod, le clic sur un interrupteur est refusé", async () => {
    const avant = automod.getConfig("g-srv2").enabled;
    const interaction = fakeInteraction("secur:srv:antiSpam", { userId: "quidam-2", guildId: "g-srv2" });
    await securityPanel.handleSecurityInteraction(interaction);
    assert.strictEqual(automod.getConfig("g-srv2").enabled, avant);
    assert.ok(interaction._replies[0]?.content.includes("permission"));
  });

  await cas("avec protection.automod, le clic bascule le MÊME magasin que &panel > Protection", async () => {
    permStore.grantToUser("g-srv3", "staff-5", "protection.automod");
    const avant = automod.getConfig("g-srv3").enabled;
    const interaction = fakeInteraction("secur:srv:antiSpam", { userId: "staff-5", guildId: "g-srv3" });
    await securityPanel.handleSecurityInteraction(interaction);
    assert.strictEqual(automod.getConfig("g-srv3").enabled, !avant);
  });

  console.log("\n!!secur — Anti-nuke (utils/guard/*.js, mêmes magasins que &panel) :");

  await cas("sans protection.guard.manage, la rubrique est verrouillée (pas de menu)", async () => {
    permStore.grantToUser("g-lock2", "staff-6", "protection.automod");
    const msg = fakeMessage("!!secur", { authorId: "staff-6", guildId: "g-lock2" });
    await securityPanel.handleSecurityTextCommand(null, msg);
    const texte = JSON.stringify(msg._channelSends[0].components);
    assert.ok(texte.includes("protection.guard.manage"), texte);
    assert.ok(!texte.includes("guardpick"));
  });

  await cas("avec protection.guard.manage, le menu liste les 13 guards réels et le sélectionner en bascule un", async () => {
    permStore.grantToUser("g-guard2", "staff-7", "protection.guard.manage");
    guardConfig.setEnabled("g-guard2", true); // interrupteur général — sinon isGuardEnabled reste faux quoi qu'on bascule

    const msg = fakeMessage("!!secur", { authorId: "staff-7", guildId: "g-guard2" });
    await securityPanel.handleSecurityTextCommand(null, msg);
    const json = msg._channelSends[0].components[0].toJSON();
    const menuRow = json.components.find((c) => c.type === 1 && c.components[0]?.type === 3);
    assert.ok(menuRow, "le menu anti-nuke doit apparaître");
    assert.strictEqual(menuRow.components[0].options.length, ALL_GUARDS.length);

    const avant = guardConfig.isGuardEnabled("g-guard2", "antibot");
    const choix = fakeInteraction("secur:guardpick", { userId: "staff-7", guildId: "g-guard2", values: ["antibot"] });
    await securityPanel.handleSecurityInteraction(choix);
    assert.strictEqual(guardConfig.isGuardEnabled("g-guard2", "antibot"), !avant);
  });

  await cas("« Tout activer »/« Tout désactiver » agissent sur les 13 guards réels", async () => {
    permStore.grantToUser("g-guard3", "staff-8", "protection.guard.manage");
    guardConfig.setEnabled("g-guard3", true);

    const on = fakeInteraction("secur:guardall:on", { userId: "staff-8", guildId: "g-guard3" });
    await securityPanel.handleSecurityInteraction(on);
    assert.ok(ALL_GUARDS.every((g) => guardConfig.isGuardEnabled("g-guard3", g.key)));

    const off = fakeInteraction("secur:guardall:off", { userId: "staff-8", guildId: "g-guard3" });
    await securityPanel.handleSecurityInteraction(off);
    assert.ok(ALL_GUARDS.every((g) => !guardConfig.isGuardEnabled("g-guard3", g.key)));
  });

  await cas("basculer un guard sans protection.guard.manage est refusé", async () => {
    const interaction = fakeInteraction("secur:guardpick", { userId: "quidam-4", guildId: "g-guard4", values: ["antibot"] });
    await securityPanel.handleSecurityInteraction(interaction);
    assert.strictEqual(interaction._updates.length, 0);
    assert.ok(interaction._replies.length > 0);
    assert.strictEqual(guardConfig.isGuardEnabled("g-guard4", "antibot"), false);
  });

  console.log("\nRésumé — données réelles, rien d'inventé :");

  await cas("compte les VRAIS propriétaires/rang sys via accessStore", async () => {
    const avant = process.env.BOT_OWNER_IDS;
    process.env.BOT_OWNER_IDS = "owner-a,owner-b";
    accessStore.add("sys", "sys-a");
    permStore.grantToUser("g-dash1", "staff-9", "protection.automod");
    const msg = fakeMessage("!!secur", { authorId: "staff-9", guildId: "g-dash1" });
    await securityPanel.handleSecurityTextCommand(null, msg);
    const texte = JSON.stringify(msg._channelSends[0].components);
    assert.ok(texte.includes("2") && texte.includes("propriétaire"), texte);
    assert.ok(texte.includes("1") && texte.includes("rang sys"), texte);
    process.env.BOT_OWNER_IDS = avant;
  });

  await cas("compte les VRAIS membres mute (rôle configuré) — pas un chiffre inventé", async () => {
    muteStore.setMuteRoleId("g-dash2", "role-mute");
    permStore.grantToUser("g-dash2", "staff-10", "protection.automod");
    const interaction = fakeInteraction("secur:srv:antiSpam", { userId: "staff-10", guildId: "g-dash2" });
    interaction.member.guild = {
      id: "g-dash2",
      roles: { cache: new Collection([["role-mute", { id: "role-mute", members: { size: 3 } }]]) },
    };
    await securityPanel.handleSecurityInteraction(interaction);
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(texte.includes("3") && texte.includes("muet"), texte);
  });

  await cas("sans client fourni, aucune stat uptime/ping n'est affichée (jamais de plantage)", async () => {
    permStore.grantToUser("g-dash3", "staff-11", "protection.automod");
    const msg = fakeMessage("!!secur", { authorId: "staff-11", guildId: "g-dash3" });
    await securityPanel.handleSecurityTextCommand(null, msg);
    assert.strictEqual(msg._channelSends.length, 1);
    const texte = JSON.stringify(msg._channelSends[0].components);
    assert.ok(!texte.includes("ping"), texte);
  });

  await cas("avec un client réel, l'uptime/ping du VRAI statusDiagnostic apparaissent", async () => {
    permStore.grantToUser("g-dash4", "staff-12", "protection.automod");
    const fauxClient = { uptime: 3_600_000, ws: { ping: 42 }, guilds: { cache: new Collection() } };
    const msg = fakeMessage("!!secur", { authorId: "staff-12", guildId: "g-dash4" });
    await securityPanel.handleSecurityTextCommand(fauxClient, msg);
    const texte = JSON.stringify(msg._channelSends[0].components);
    assert.ok(texte.includes("42ms"), texte);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
