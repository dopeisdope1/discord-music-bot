/**
 * Panel de protection PERSONNELLE ("!!panel", utils/personalProtection.js) —
 * self-service, sans permission requise : Anti-Retrait-Rôle,
 * Anti-Déplacement-Vocal, Anti-Sourdine-Forcée, Anti-Timeout,
 * Anti-Renommage, Anti-Bannissement, Alerte-Expulsion, Anti-Ping-Fantôme.
 * Chacune passe par estActionLegitime() avant d'annuler quoi que ce soit :
 * sans ce filtre, n'importe qui pourrait s'auto-immuniser contre une vraie
 * sanction juste en activant "Anti-Bannissement".
 *
 * La rubrique "Sécurité serveur" + l'anti-nuke ont été scindées dans
 * "!!secur" (voir scripts/test-security-panel.js et
 * utils/securityPanel.js) — demande explicite : "une commande pour panel
 * perso et une commande avec tout les truc de securité".
 *
 * Lancement : node scripts/test-personal-protection.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "personal-protection-test-"));
process.env.BOT_OWNER_IDS = "";

const { Collection, PermissionsBitField, AuditLogEvent } = require("discord.js");
const personalProtection = require("../utils/personalProtection");
const store = require("../utils/personalProtectionStore");
const permStore = require("../utils/permissions/store");
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

// ---- Fixtures ----

function fakeGuild(id) {
  const membersMap = new Map();
  const usersMap = new Map();
  const guild = {
    id,
    name: "Serveur Test",
    roles: { cache: new Collection() },
    channels: { cache: new Collection() },
    members: {
      me: { permissions: new PermissionsBitField(PermissionsBitField.All) },
      fetch: async (uid) => membersMap.get(uid) || null,
      unban: async (uid, reason) => {
        guild._unbanned = { uid, reason };
      },
    },
    client: {
      user: { id: "bot-1" },
      users: { fetch: async (uid) => usersMap.get(uid) || null },
    },
    fetchAuditLogs: async () => ({ entries: new Collection() }),
    _membersMap: membersMap,
    _usersMap: usersMap,
  };
  return guild;
}

function fakeMember(guild, id, { rolesCache = new Collection() } = {}) {
  const membre = {
    id,
    guild: { id: guild.id },
    user: { id, bot: false, tag: `${id}#0000` },
    roles: {
      cache: rolesCache,
      add: async function (ids) {
        this._added = ids;
      },
    },
    voice: {
      setMute: async function (v) {
        this._mute = v;
      },
      setDeaf: async function (v) {
        this._deaf = v;
      },
      setChannel: async function (channelId) {
        this._channel = channelId;
      },
    },
    timeout: async function (v) {
      this._timeout = v;
    },
    setNickname: async function (v) {
      this._nickname = v;
    },
  };
  guild._membersMap.set(id, membre);
  return membre;
}

function fakeBotMember(guild, id) {
  const membre = fakeMember(guild, id);
  membre.user.bot = true;
  return membre;
}

function fakeUser(guild, id, tag) {
  const utilisateur = { id, tag, bot: false, _dm: [], send: async function (content) { this._dm.push(content); return {}; } };
  guild._usersMap.set(id, utilisateur);
  return utilisateur;
}

function fakeChannel(id) {
  return {
    id,
    isTextBased: () => true,
    viewable: true,
    permissionsFor: () => ({ has: () => true }),
    createInvite: async () => ({ url: `https://discord.gg/test-${id}` }),
  };
}

function fakeRole(id, name = id) {
  return { id, name };
}

function auditEntry({ action, targetId, executorId, changes = [], extra, createdTimestamp = Date.now() }) {
  return { action, targetId, executorId, changes, extra, createdTimestamp };
}

(async () => {
  console.log("Préfixe dédié :");

  await cas("le préfixe par défaut est \"!!\", distinct de \"&\"", () => {
    const { protection, musicMod } = getPrefixes("g-quelconque");
    assert.strictEqual(protection, "!!");
    assert.notStrictEqual(protection, musicMod);
  });

  console.log("\n!!panel — panneau personnel :");

  function fakeMessage(content, { authorId = "u1", guildId = "g1" } = {}) {
    const replies = [];
    return {
      content,
      author: { id: authorId, bot: false },
      guild: { id: guildId },
      member: { id: authorId, guild: { id: guildId }, roles: { cache: new Collection() } },
      reply: async (p) => {
        const envoye = { id: `msg-${replies.length}`, ...p };
        replies.push(p);
        return envoye;
      },
      _replies: replies,
    };
  }

  function fakeInteraction(customId, { userId = "u1", guildId = "g1", values } = {}) {
    const updates = [];
    const replies = [];
    return {
      customId,
      guild: { id: guildId },
      user: { id: userId },
      member: { id: userId, guild: { id: guildId }, roles: { cache: new Collection() } },
      values,
      update: async (p) => updates.push(p),
      reply: async (p) => replies.push(p),
      _updates: updates,
      _replies: replies,
    };
  }

  await cas("poste bien un panel Components V2 avec les 8 protections personnelles", async () => {
    const msg = fakeMessage("!!panel");
    await personalProtection.handleProtectionTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 1);
    const texte = JSON.stringify(msg._replies[0].components);
    for (const cle of Object.keys(store.PROTECTIONS)) {
      assert.ok(texte.includes(cle), `protection manquante dans le panel : ${cle}`);
    }
  });

  await cas("un mot inconnu sur ce préfixe reste silencieux", async () => {
    const msg = fakeMessage("!!nimportequoi");
    await personalProtection.handleProtectionTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("le préfixe & (modération) n'est pas concerné", async () => {
    const msg = fakeMessage("&panel");
    await personalProtection.handleProtectionTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("!!panel n'a plus de rubrique Sécurité serveur — scindée dans !!secur", async () => {
    const msg = fakeMessage("!!panel", { authorId: "staff-1", guildId: "g-scission" });
    permStore.grantToUser("g-scission", "staff-1", "protection.automod");
    await personalProtection.handleProtectionTextCommand(null, msg);
    const texte = JSON.stringify(msg._replies[0].components);
    assert.ok(!texte.includes("Sécurité serveur"), texte);
    assert.ok(!texte.includes("guardpick"), texte);
  });

  console.log("\nRang réel affiché dans le résumé (Owner/Sys/Membre — pas de rang inventé) :");

  await cas("un membre ordinaire est affiché \"Membre\"", async () => {
    const interaction = fakeInteraction("prot:toggle:antiRoleRemove", { userId: "u-rang1", guildId: "g-rang1" });
    await personalProtection.handleProtectionInteraction(interaction);
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(texte.includes("Membre"), texte);
  });

  await cas("le propriétaire (BOT_OWNER_IDS) est affiché \"Propriétaire\"", async () => {
    const avant = process.env.BOT_OWNER_IDS;
    process.env.BOT_OWNER_IDS = "u-rang2";
    const interaction = fakeInteraction("prot:toggle:antiRoleRemove", { userId: "u-rang2", guildId: "g-rang2" });
    await personalProtection.handleProtectionInteraction(interaction);
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(texte.includes("Propriétaire"), texte);
    process.env.BOT_OWNER_IDS = avant;
  });

  await cas("le rang sys (&zinki) est affiché \"Rang sys\"", async () => {
    const accessStore = require("../utils/accessStore");
    accessStore.add("sys", "u-rang3");
    const interaction = fakeInteraction("prot:toggle:antiRoleRemove", { userId: "u-rang3", guildId: "g-rang3" });
    await personalProtection.handleProtectionInteraction(interaction);
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(texte.includes("Rang sys"), texte);
  });

  console.log("\nBascule d'une protection personnelle :");

  await cas("un clic sur le bouton toggle active la protection pour CE membre", async () => {
    assert.strictEqual(store.isEnabled("g2", "u2", "antiRoleRemove"), false);
    const interaction = {
      customId: "prot:toggle:antiRoleRemove",
      guild: { id: "g2" },
      user: { id: "u2" },
      member: { id: "u2", guild: { id: "g2" }, roles: { cache: new Collection() } },
      update: async () => {},
    };
    await personalProtection.handleProtectionInteraction(interaction);
    assert.strictEqual(store.isEnabled("g2", "u2", "antiRoleRemove"), true);
  });

  await cas("n'affecte pas un autre membre du même serveur", async () => {
    assert.strictEqual(store.isEnabled("g2", "u3", "antiRoleRemove"), false);
  });

  console.log("\nAnti-Retrait Rôle (via l'audit log, MemberRoleUpdate) :");

  await cas("un rôle retiré par un exécuteur SANS members.role est réappliqué", async () => {
    const guild = fakeGuild("g10");
    guild.roles.cache.set("role-a", fakeRole("role-a"));
    const cible = fakeMember(guild, "u10");
    fakeMember(guild, "mod-illegit");
    store.toggle("g10", "u10", "antiRoleRemove");

    const entry = auditEntry({
      action: AuditLogEvent.MemberRoleUpdate,
      targetId: "u10",
      executorId: "mod-illegit",
      changes: [{ key: "$remove", new: [fakeRole("role-a")] }],
    });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.deepStrictEqual(cible.roles._added, ["role-a"]);
  });

  await cas("un exécuteur AVEC members.role n'est pas annulé", async () => {
    const guild = fakeGuild("g11");
    guild.roles.cache.set("role-a", fakeRole("role-a"));
    const cible = fakeMember(guild, "u11");
    const mod = fakeMember(guild, "mod-legit");
    permStore.grantToUser("g11", "mod-legit", "members.role");
    store.toggle("g11", "u11", "antiRoleRemove");

    const entry = auditEntry({
      action: AuditLogEvent.MemberRoleUpdate,
      targetId: "u11",
      executorId: "mod-legit",
      changes: [{ key: "$remove", new: [fakeRole("role-a")] }],
    });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.strictEqual(cible.roles._added, undefined);
  });

  await cas("l'exécuteur = ce bot lui-même (commande légitime &delrole) n'est jamais annulé", async () => {
    const guild = fakeGuild("g12");
    guild.roles.cache.set("role-a", fakeRole("role-a"));
    const cible = fakeMember(guild, "u12");
    store.toggle("g12", "u12", "antiRoleRemove");

    const entry = auditEntry({
      action: AuditLogEvent.MemberRoleUpdate,
      targetId: "u12",
      executorId: "bot-1", // = guild.client.user.id
      changes: [{ key: "$remove", new: [fakeRole("role-a")] }],
    });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.strictEqual(cible.roles._added, undefined);
  });

  await cas("un AUTRE bot du serveur (ex. CrowBot) n'est jamais annulé non plus", async () => {
    const guild = fakeGuild("g13b");
    guild.roles.cache.set("role-a", fakeRole("role-a"));
    const cible = fakeMember(guild, "u13b");
    fakeBotMember(guild, "crowbot-1");
    store.toggle("g13b", "u13b", "antiRoleRemove");

    const entry = auditEntry({
      action: AuditLogEvent.MemberRoleUpdate,
      targetId: "u13b",
      executorId: "crowbot-1",
      changes: [{ key: "$remove", new: [fakeRole("role-a")] }],
    });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.strictEqual(cible.roles._added, undefined);
  });

  await cas("un rôle qui n'existe plus du tout sur le serveur n'est pas réappliqué", async () => {
    const guild = fakeGuild("g13"); // "role-supprime" n'est PAS dans guild.roles.cache
    const cible = fakeMember(guild, "u13");
    fakeMember(guild, "mod-illegit");
    store.toggle("g13", "u13", "antiRoleRemove");

    const entry = auditEntry({
      action: AuditLogEvent.MemberRoleUpdate,
      targetId: "u13",
      executorId: "mod-illegit",
      changes: [{ key: "$remove", new: [fakeRole("role-supprime")] }],
    });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.strictEqual(cible.roles._added, undefined);
  });

  await cas("protection désactivée : aucune action", async () => {
    const guild = fakeGuild("g14");
    guild.roles.cache.set("role-a", fakeRole("role-a"));
    const cible = fakeMember(guild, "u14");
    fakeMember(guild, "mod-illegit");

    const entry = auditEntry({
      action: AuditLogEvent.MemberRoleUpdate,
      targetId: "u14",
      executorId: "mod-illegit",
      changes: [{ key: "$remove", new: [fakeRole("role-a")] }],
    });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.strictEqual(cible.roles._added, undefined);
  });

  console.log("\nAnti-Renommage (MemberUpdate, changement \"nick\") :");

  await cas("un pseudo changé par un exécuteur SANS members.nick est restauré", async () => {
    const guild = fakeGuild("g20");
    const cible = fakeMember(guild, "u20");
    fakeMember(guild, "mod-illegit");
    store.toggle("g20", "u20", "antiRename");

    const entry = auditEntry({
      action: AuditLogEvent.MemberUpdate,
      targetId: "u20",
      executorId: "mod-illegit",
      changes: [{ key: "nick", old: "AncienPseudo", new: "PseudoImpose" }],
    });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.strictEqual(cible._nickname, "AncienPseudo");
  });

  await cas("un exécuteur AVEC members.nick n'est pas annulé", async () => {
    const guild = fakeGuild("g21");
    const cible = fakeMember(guild, "u21");
    fakeMember(guild, "mod-legit");
    permStore.grantToUser("g21", "mod-legit", "members.nick");
    store.toggle("g21", "u21", "antiRename");

    const entry = auditEntry({
      action: AuditLogEvent.MemberUpdate,
      targetId: "u21",
      executorId: "mod-legit",
      changes: [{ key: "nick", old: "AncienPseudo", new: "NouveauPseudo" }],
    });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.strictEqual(cible._nickname, undefined);
  });

  console.log("\nAnti-Timeout (MemberUpdate, changement \"communication_disabled_until\") :");

  await cas("un NOUVEAU timeout imposé par un exécuteur SANS moderation.timeout est levé", async () => {
    const guild = fakeGuild("g30");
    const cible = fakeMember(guild, "u30");
    fakeMember(guild, "mod-illegit");
    store.toggle("g30", "u30", "antiTimeout");

    const entry = auditEntry({
      action: AuditLogEvent.MemberUpdate,
      targetId: "u30",
      executorId: "mod-illegit",
      changes: [{ key: "communication_disabled_until", old: null, new: new Date(Date.now() + 600000).toISOString() }],
    });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.strictEqual(cible._timeout, null);
  });

  await cas("une FIN de timeout (new vide) n'est jamais traitée comme une attaque", async () => {
    const guild = fakeGuild("g31");
    const cible = fakeMember(guild, "u31");
    fakeMember(guild, "mod-illegit");
    store.toggle("g31", "u31", "antiTimeout");

    const entry = auditEntry({
      action: AuditLogEvent.MemberUpdate,
      targetId: "u31",
      executorId: "mod-illegit",
      changes: [{ key: "communication_disabled_until", old: new Date().toISOString(), new: null }],
    });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.strictEqual(cible._timeout, undefined, "on n'annule jamais une LEVÉE de timeout");
  });

  await cas("un exécuteur AVEC moderation.timeout n'est pas annulé", async () => {
    const guild = fakeGuild("g32");
    const cible = fakeMember(guild, "u32");
    fakeMember(guild, "mod-legit");
    permStore.grantToUser("g32", "mod-legit", "moderation.timeout");
    store.toggle("g32", "u32", "antiTimeout");

    const entry = auditEntry({
      action: AuditLogEvent.MemberUpdate,
      targetId: "u32",
      executorId: "mod-legit",
      changes: [{ key: "communication_disabled_until", old: null, new: new Date(Date.now() + 600000).toISOString() }],
    });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.strictEqual(cible._timeout, undefined);
  });

  console.log("\nAnti-Sourdine Forcée (MemberUpdate, changements \"mute\"/\"deaf\") :");

  await cas("un mute vocal imposé par un exécuteur illégitime est annulé", async () => {
    const guild = fakeGuild("g40");
    const cible = fakeMember(guild, "u40");
    fakeMember(guild, "mod-illegit");
    store.toggle("g40", "u40", "antiMuteDeafen");

    const entry = auditEntry({
      action: AuditLogEvent.MemberUpdate,
      targetId: "u40",
      executorId: "mod-illegit",
      changes: [{ key: "mute", old: false, new: true }],
    });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.strictEqual(cible.voice._mute, false);
  });

  await cas("un deafen vocal imposé par un exécuteur illégitime est annulé", async () => {
    const guild = fakeGuild("g41");
    const cible = fakeMember(guild, "u41");
    fakeMember(guild, "mod-illegit");
    store.toggle("g41", "u41", "antiMuteDeafen");

    const entry = auditEntry({
      action: AuditLogEvent.MemberUpdate,
      targetId: "u41",
      executorId: "mod-illegit",
      changes: [{ key: "deaf", old: false, new: true }],
    });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.strictEqual(cible.voice._deaf, false);
  });

  console.log("\nAnti-Bannissement (MemberBanAdd) :");

  await cas("un bannissement par un exécuteur SANS moderation.ban est annulé (débanni)", async () => {
    const guild = fakeGuild("g50");
    fakeMember(guild, "mod-illegit");
    store.toggle("g50", "u50", "antiBan");

    const entry = auditEntry({ action: AuditLogEvent.MemberBanAdd, targetId: "u50", executorId: "mod-illegit" });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.deepStrictEqual(guild._unbanned, { uid: "u50", reason: "Anti-Bannissement (!!panel)" });
  });

  await cas("un exécuteur AVEC moderation.ban n'est pas annulé (reste banni)", async () => {
    const guild = fakeGuild("g51");
    fakeMember(guild, "mod-legit");
    permStore.grantToUser("g51", "mod-legit", "moderation.ban");
    store.toggle("g51", "u51", "antiBan");

    const entry = auditEntry({ action: AuditLogEvent.MemberBanAdd, targetId: "u51", executorId: "mod-legit" });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.strictEqual(guild._unbanned, undefined);
  });

  console.log("\nAlerte Expulsion (MemberKick — pas de retour de force possible, juste un MP) :");

  await cas("une expulsion par un exécuteur illégitime envoie une invitation en MP", async () => {
    const guild = fakeGuild("g60");
    fakeMember(guild, "mod-illegit");
    const utilisateur = fakeUser(guild, "u60", "u60#0000");
    guild.channels.cache.set("salon-1", fakeChannel("salon-1"));
    store.toggle("g60", "u60", "antiKick");

    const entry = auditEntry({ action: AuditLogEvent.MemberKick, targetId: "u60", executorId: "mod-illegit" });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.strictEqual(utilisateur._dm.length, 1);
    assert.ok(utilisateur._dm[0].includes("discord.gg"));
  });

  await cas("un exécuteur AVEC moderation.kick ne déclenche aucune alerte", async () => {
    const guild = fakeGuild("g61");
    fakeMember(guild, "mod-legit");
    permStore.grantToUser("g61", "mod-legit", "moderation.kick");
    const utilisateur = fakeUser(guild, "u61", "u61#0000");
    store.toggle("g61", "u61", "antiKick");

    const entry = auditEntry({ action: AuditLogEvent.MemberKick, targetId: "u61", executorId: "mod-legit" });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.strictEqual(utilisateur._dm.length, 0);
  });

  console.log("\nAnti-Déplacement Vocal (voiceStateUpdate + recoupement audit log) :");

  await cas("un déplacement imposé et récent (MemberMove) est annulé", async () => {
    const guild = fakeGuild("g70");
    const cible = fakeMember(guild, "u70");
    fakeMember(guild, "mod-illegit");
    store.toggle("g70", "u70", "antiMove");

    guild.fetchAuditLogs = async () => ({
      entries: new Collection([
        ["e1", auditEntry({ action: AuditLogEvent.MemberMove, executorId: "mod-illegit", extra: { channel: { id: "chan-b" } } })],
      ]),
    });

    const oldState = { channelId: "chan-a" };
    const newState = { channelId: "chan-b", member: cible, guild };
    await personalProtection.enforceMoveProtection(oldState, newState);
    assert.strictEqual(cible.voice._channel, "chan-a");
  });

  await cas("un changement volontaire (aucune entrée MemberMove correspondante) n'est pas annulé", async () => {
    const guild = fakeGuild("g71");
    const cible = fakeMember(guild, "u71");
    store.toggle("g71", "u71", "antiMove");
    // guild.fetchAuditLogs renvoie une liste vide par défaut (fakeGuild)

    const oldState = { channelId: "chan-a" };
    const newState = { channelId: "chan-b", member: cible, guild };
    await personalProtection.enforceMoveProtection(oldState, newState);
    assert.strictEqual(cible.voice._channel, undefined);
  });

  await cas("un déplacement par ce bot lui-même n'est pas annulé", async () => {
    const guild = fakeGuild("g72");
    const cible = fakeMember(guild, "u72");
    store.toggle("g72", "u72", "antiMove");
    guild.fetchAuditLogs = async () => ({
      entries: new Collection([
        ["e1", auditEntry({ action: AuditLogEvent.MemberMove, executorId: "bot-1", extra: { channel: { id: "chan-b" } } })],
      ]),
    });

    const oldState = { channelId: "chan-a" };
    const newState = { channelId: "chan-b", member: cible, guild };
    await personalProtection.enforceMoveProtection(oldState, newState);
    assert.strictEqual(cible.voice._channel, undefined);
  });

  console.log("\nAnti Ping Fantôme (messageDelete — alerte seule, jamais d'annulation) :");

  function fakeMessage2(guild, { authorId = "auteur-1", authorBot = false, content = "hey @cible regarde ça", mentionIds = [] } = {}) {
    const mentionsCollection = new Collection(mentionIds.map((id) => [id, guild._usersMap.get(id)]));
    return {
      guild,
      author: { id: authorId, bot: authorBot, tag: `${authorId}#0000` },
      content,
      mentions: { users: mentionsCollection },
    };
  }

  await cas("un message qui mentionne un protégé, puis supprimé, déclenche un MP avec le contenu", async () => {
    const guild = fakeGuild("g80");
    const cible = fakeUser(guild, "u80", "u80#0000");
    store.toggle("g80", "u80", "antiGhostPing");
    const message = fakeMessage2(guild, { content: "hey <@u80> regarde ça", mentionIds: ["u80"] });

    await personalProtection.enforceGhostPingAlert(message);
    assert.strictEqual(cible._dm.length, 1);
    assert.ok(cible._dm[0].includes("regarde ça"));
  });

  await cas("un membre non protégé ne reçoit rien", async () => {
    const guild = fakeGuild("g81");
    const cible = fakeUser(guild, "u81", "u81#0000");
    const message = fakeMessage2(guild, { content: "hey <@u81>", mentionIds: ["u81"] });

    await personalProtection.enforceGhostPingAlert(message);
    assert.strictEqual(cible._dm.length, 0);
  });

  await cas("un message envoyé par un bot est ignoré", async () => {
    const guild = fakeGuild("g82");
    const cible = fakeUser(guild, "u82", "u82#0000");
    store.toggle("g82", "u82", "antiGhostPing");
    const message = fakeMessage2(guild, { authorBot: true, content: "hey <@u82>", mentionIds: ["u82"] });

    await personalProtection.enforceGhostPingAlert(message);
    assert.strictEqual(cible._dm.length, 0);
  });

  await cas("s'auto-mentionner puis se supprimer n'envoie rien", async () => {
    const guild = fakeGuild("g83");
    const cible = fakeUser(guild, "u83", "u83#0000");
    store.toggle("g83", "u83", "antiGhostPing");
    const message = fakeMessage2(guild, { authorId: "u83", content: "hey <@u83>", mentionIds: ["u83"] });

    await personalProtection.enforceGhostPingAlert(message);
    assert.strictEqual(cible._dm.length, 0);
  });

  console.log("\nGestion des listes personnelles (menu déroulant \"listaction\" + UserSelectMenu) :");

  const lists = require("../utils/personalListsStore");

  await cas("choisir une liste dans le menu révèle son état, un seul aller-retour", async () => {
    const interaction = fakeInteraction("prot:listaction", { userId: "u90", guildId: "g90", values: ["antiCafard"] });
    await personalProtection.handleProtectionInteraction(interaction);
    assert.strictEqual(interaction._updates.length, 1);
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(texte.includes("Liste actuelle"), texte);
  });

  await cas("ajouter quelqu'un via listadd l'ajoute vraiment à la liste", async () => {
    const interaction = fakeInteraction("prot:listadd:antiCafard", { userId: "u91", guildId: "g91", values: ["cible-1"] });
    await personalProtection.handleProtectionInteraction(interaction);
    assert.deepStrictEqual(lists.getList("g91", "u91", "antiCafard"), ["cible-1"]);
  });

  await cas("retirer via listdel enlève vraiment de la liste (bascule inverse)", async () => {
    lists.toggleInList("g92", "u92", "fuiteVocale", "cible-2");
    const interaction = fakeInteraction("prot:listdel:fuiteVocale", { userId: "u92", guildId: "g92", values: ["cible-2"] });
    await personalProtection.handleProtectionInteraction(interaction);
    assert.deepStrictEqual(lists.getList("g92", "u92", "fuiteVocale"), []);
  });

  await cas("ajouter deux fois la même personne ne duplique pas (idempotent)", async () => {
    const interaction1 = fakeInteraction("prot:listadd:antiMentionPerso", { userId: "u93", guildId: "g93", values: ["cible-3"] });
    await personalProtection.handleProtectionInteraction(interaction1);
    const interaction2 = fakeInteraction("prot:listadd:antiMentionPerso", { userId: "u93", guildId: "g93", values: ["cible-3"] });
    await personalProtection.handleProtectionInteraction(interaction2);
    assert.deepStrictEqual(lists.getList("g93", "u93", "antiMentionPerso"), ["cible-3"]);
  });

  await cas("\"target\" définit la cible désignée de Mute Bot", async () => {
    const interaction = fakeInteraction("prot:target", { userId: "u94", guildId: "g94", values: ["cible-mutebot"] });
    await personalProtection.handleProtectionInteraction(interaction);
    assert.strictEqual(lists.getTarget("g94", "u94"), "cible-mutebot");
  });

  await cas("\"target\" avec une sélection vide efface la cible", async () => {
    lists.setTarget("g95", "u95", "ancienne-cible");
    const interaction = fakeInteraction("prot:target", { userId: "u95", guildId: "g95", values: [] });
    await personalProtection.handleProtectionInteraction(interaction);
    assert.strictEqual(lists.getTarget("g95", "u95"), null);
  });

  await cas("listadd/listdel refusent \"muteBot\" (ce n'est pas une liste, une cible unique)", async () => {
    const interaction = fakeInteraction("prot:listadd:muteBot", { userId: "u96", guildId: "g96", values: ["x"] });
    await personalProtection.handleProtectionInteraction(interaction);
    assert.strictEqual(interaction._updates.length, 0);
  });

  console.log("\nQuarantaine Admin (isole l'exécuteur illégitime, en plus de l'annulation habituelle) :");

  const quarantineStore = require("../utils/adminQuarantineStore");

  await cas("un rôle retiré illégitimement met aussi l'exécuteur en quarantaine (rôles retirés)", async () => {
    const guild = fakeGuild("g100");
    guild.roles.cache.set("role-a", fakeRole("role-a"));
    const cible = fakeMember(guild, "u100");
    const executeur = fakeMember(guild, "mod-illegit-100", { rolesCache: new Collection([["role-x", fakeRole("role-x")]]) });
    executeur.roles.remove = async function (ids) {
      this._removed = ids;
      for (const id of ids) this.cache.delete(id);
    };
    store.toggle("g100", "u100", "antiRoleRemove");
    store.toggle("g100", "u100", "quarantineAdmin"); // c'est le PROTÉGÉ (cible) qui active Quarantaine Admin sur lui-même

    const entry = auditEntry({
      action: AuditLogEvent.MemberRoleUpdate,
      targetId: "u100",
      executorId: "mod-illegit-100",
      changes: [{ key: "$remove", new: [fakeRole("role-a")] }],
    });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.deepStrictEqual(executeur.roles._removed, ["role-x"]);
    assert.strictEqual(quarantineStore.getExpired().length, 0); // pas encore expiré
  });

  await cas("sans quarantineAdmin activé POUR LA CIBLE PROTÉGÉE, rien n'est retiré à l'exécuteur", async () => {
    const guild = fakeGuild("g101");
    guild.roles.cache.set("role-a", fakeRole("role-a"));
    fakeMember(guild, "u101");
    const executeur = fakeMember(guild, "mod-illegit-101", { rolesCache: new Collection([["role-x", fakeRole("role-x")]]) });
    executeur.roles.remove = async function (ids) {
      this._removed = ids;
    };
    store.toggle("g101", "u101", "antiRoleRemove");
    // "quarantineAdmin" jamais activé pour u101 (la cible protégée)

    const entry = auditEntry({
      action: AuditLogEvent.MemberRoleUpdate,
      targetId: "u101",
      executorId: "mod-illegit-101",
      changes: [{ key: "$remove", new: [fakeRole("role-a")] }],
    });
    await personalProtection.handleAuditLogEntry(null, guild, entry);
    assert.strictEqual(executeur.roles._removed, undefined);
  });

  await cas("checkExpiredQuarantines restaure les rôles snapshotés après échéance", async () => {
    const guild = fakeGuild("g102");
    guild.roles.cache.set("role-a", fakeRole("role-a"));
    const executeur = fakeMember(guild, "mod-102");
    quarantineStore.add("g102", "mod-102", ["role-a"], Date.now() - 1000); // déjà expiré
    const fakeClient = { guilds: { cache: new Collection([["g102", guild]]) } };

    await personalProtection.checkExpiredQuarantines(fakeClient);
    assert.deepStrictEqual(executeur.roles._added, ["role-a"]);
    assert.strictEqual(quarantineStore.getExpired().some((q) => q.guildId === "g102" && q.userId === "mod-102"), false);
  });

  await cas("une quarantaine PAS ENCORE expirée n'est pas touchée", async () => {
    const guild = fakeGuild("g103");
    guild.roles.cache.set("role-a", fakeRole("role-a"));
    const executeur = fakeMember(guild, "mod-103");
    quarantineStore.add("g103", "mod-103", ["role-a"], Date.now() + 3600_000); // pas encore expiré
    const fakeClient = { guilds: { cache: new Collection([["g103", guild]]) } };

    await personalProtection.checkExpiredQuarantines(fakeClient);
    assert.strictEqual(executeur.roles._added, undefined);
  });

  console.log("\nAnti-Mention Perso (messageCreate — alerte seule, jamais de sanction) :");

  function fakeMessageMention(guild, { authorId = "auteur-m", mentionIds = [] } = {}) {
    const mentionsCollection = new Collection(mentionIds.map((id) => [id, guild._usersMap.get(id)]));
    return {
      guild,
      author: { id: authorId, bot: false, tag: `${authorId}#0000` },
      mentions: { users: mentionsCollection },
    };
  }

  await cas("un membre surveillé qui mentionne le protégé déclenche une alerte MP", async () => {
    const guild = fakeGuild("g110");
    const protege = fakeUser(guild, "u110", "u110#0000");
    store.toggle("g110", "u110", "antiMentionPerso");
    lists.toggleInList("g110", "u110", "antiMentionPerso", "surveille-1");
    const message = fakeMessageMention(guild, { authorId: "surveille-1", mentionIds: ["u110"] });

    await personalProtection.enforcePersonalMentionAlert(message);
    assert.strictEqual(protege._dm.length, 1);
  });

  await cas("une mention par quelqu'un HORS de la liste ne déclenche rien", async () => {
    const guild = fakeGuild("g111");
    const protege = fakeUser(guild, "u111", "u111#0000");
    store.toggle("g111", "u111", "antiMentionPerso");
    const message = fakeMessageMention(guild, { authorId: "inconnu-1", mentionIds: ["u111"] });

    await personalProtection.enforcePersonalMentionAlert(message);
    assert.strictEqual(protege._dm.length, 0);
  });

  console.log("\nAnti-Delete Message (messageDelete — best-effort audit log, silence si autosuppression) :");

  await cas("un message supprimé par QUELQU'UN D'AUTRE (audit log) déclenche une alerte", async () => {
    const guild = fakeGuild("g120");
    const auteur = fakeUser(guild, "u120", "u120#0000");
    store.toggle("g120", "u120", "antiDeleteMessage");
    guild.fetchAuditLogs = async () => ({
      entries: new Collection([
        [
          "e1",
          auditEntry({
            action: AuditLogEvent.MessageDelete,
            targetId: "u120",
            executorId: "mod-suppresseur",
            extra: { channel: { id: "chan-x" } },
          }),
        ],
      ]),
    });
    const message = { guild, author: auteur, content: "message important", channelId: "chan-x" };

    await personalProtection.enforceDeleteAlert(message);
    assert.strictEqual(auteur._dm.length, 1);
    assert.ok(auteur._dm[0].includes("mod-suppresseur"));
  });

  await cas("sans entrée d'audit correspondante (probable autosuppression), silence total", async () => {
    const guild = fakeGuild("g121");
    const auteur = fakeUser(guild, "u121", "u121#0000");
    store.toggle("g121", "u121", "antiDeleteMessage");
    // fakeGuild renvoie une liste d'entrées vide par défaut

    const message = { guild, author: auteur, content: "message quelconque", channelId: "chan-y" };
    await personalProtection.enforceDeleteAlert(message);
    assert.strictEqual(auteur._dm.length, 0);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
