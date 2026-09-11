/**
 * Panel de protection PERSONNELLE ("!!panel", utils/personalProtection.js).
 *
 * Volontairement sur un préfixe séparé de &panel (config serveur) pour ne
 * jamais se mélanger — demande explicite. Deux familles de protections :
 *
 *  - PERSONNELLES (self-service, sans permission) : Anti-Retrait-Rôle,
 *    Anti-Déplacement-Vocal, Anti-Sourdine-Forcée, Anti-Timeout,
 *    Anti-Renommage, Anti-Bannissement, Alerte-Expulsion, Anti-Ping-Fantôme.
 *    Chacune passe par estActionLegitime() avant d'annuler quoi que ce soit :
 *    sans ce filtre, n'importe qui pourrait s'auto-immuniser contre une
 *    vraie sanction juste en activant "Anti-Bannissement".
 *  - "Sécurité serveur" : mêmes 4 interrupteurs que &panel > Protection
 *    (antispam/antilien/antimention/mots interdits), mêmes magasins —
 *    demande explicite ("tout les protections qu'il y'a dans le &panel
 *    ajoute les dans !!panel"), gatée par protection.automod comme dans
 *    &panel.
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
const automod = require("../utils/automod/antiSpam");
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

  await cas("sans panel.permissions... pardon, sans protection.automod, la rubrique Sécurité serveur n'apparaît pas", async () => {
    const msg = fakeMessage("!!panel", { authorId: "quidam-1" });
    await personalProtection.handleProtectionTextCommand(null, msg);
    const texte = JSON.stringify(msg._replies[0].components);
    assert.ok(!texte.includes("Sécurité serveur"));
  });

  await cas("avec protection.automod, la rubrique Sécurité serveur apparaît avec ses 4 interrupteurs", async () => {
    permStore.grantToUser("g1", "staff-1", "protection.automod");
    const msg = fakeMessage("!!panel", { authorId: "staff-1" });
    await personalProtection.handleProtectionTextCommand(null, msg);
    const texte = JSON.stringify(msg._replies[0].components);
    assert.ok(texte.includes("Sécurité serveur"));
    assert.ok(texte.includes("prot:srv:antiSpam"));
    assert.ok(texte.includes("prot:srv:antiLien"));
    assert.ok(texte.includes("prot:srv:antiMassMention"));
    assert.ok(texte.includes("prot:srv:motsInterdits"));
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

  console.log("\nBascule de la rubrique Sécurité serveur (mêmes magasins que &panel) :");

  await cas("sans protection.automod, le clic est refusé", async () => {
    const avant = automod.getConfig("g3").enabled;
    const interaction = {
      customId: "prot:srv:antiSpam",
      guild: { id: "g3" },
      user: { id: "quidam-2" },
      member: { id: "quidam-2", guild: { id: "g3" }, roles: { cache: new Collection() } },
      reply: async (p) => {
        interaction._reply = p;
      },
    };
    await personalProtection.handleProtectionInteraction(interaction);
    assert.strictEqual(automod.getConfig("g3").enabled, avant, "l'état ne doit pas avoir changé");
    assert.ok(interaction._reply?.content.includes("permission"));
  });

  await cas("avec protection.automod, le clic bascule le MÊME magasin que &panel > Protection", async () => {
    permStore.grantToUser("g3", "staff-2", "protection.automod");
    const avant = automod.getConfig("g3").enabled;
    const interaction = {
      customId: "prot:srv:antiSpam",
      guild: { id: "g3" },
      user: { id: "staff-2" },
      member: { id: "staff-2", guild: { id: "g3" }, roles: { cache: new Collection() } },
      update: async () => {},
    };
    await personalProtection.handleProtectionInteraction(interaction);
    assert.strictEqual(automod.getConfig("g3").enabled, !avant);
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

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
