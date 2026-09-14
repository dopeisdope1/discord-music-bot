/**
 * Vérifie le moteur anti-nuke (utils/guard/) : seuils respectés, owner/sys/
 * whitelist entièrement exemptés (pas seulement de la sanction), plafond de
 * sanctions par minute, restauration (annulation) pour les guards qui le
 * permettent (ban/débannissement).
 *
 * DATA_DIR pointe vers un dossier temporaire créé pour ce process.
 *
 * Lancement : node scripts/test-guard.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Collection, AuditLogEvent, PermissionsBitField } = require("discord.js");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "guard-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const accessStore = require("../utils/accessStore");
const guardConfig = require("../utils/guard/config");
const guardWhitelist = require("../utils/guard/whitelist");
const { checkAuditEntry, checkJoinFlood } = require("../utils/guard/definitions");

const GUILD_ID = "guild-1";
const BOT_ID = "bot-1";

guardConfig.setEnabled(GUILD_ID, true);

function fakeMember({ id, position = 5, banned = [] }) {
  const membre = {
    id,
    tag: `${id}#0000`,
    user: { tag: `${id}#0000` },
    kick: async function () { this.kicked = true; },
    ban: async function () { this.banned = true; },
    timeout: async function () { this.timedOut = true; },
  };
  membre.roles = { cache: new Collection(), highest: { position }, set: async () => { membre.deranked = true; } };
  return membre;
}

function fakeGuild({ id = GUILD_ID, ownerId = "server-owner", members = [] } = {}) {
  const cache = new Collection(members.map((m) => [m.id, m]));
  const banned = new Set();
  guardConfig.setEnabled(id, true);
  const guild = {
    id,
    name: "Serveur test",
    ownerId,
    members: {
      me: { id: BOT_ID, roles: { highest: { position: 50 } } },
      cache,
      fetch: async (memberId) => cache.get(memberId) || null,
    },
    bans: {
      remove: async (banId) => banned.delete(banId),
      _set: banned,
    },
  };
  for (const m of members) m.guild = guild;
  return guild;
}

let reussis = 0;
function cas(nom, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      reussis++;
      console.log(`  ok — ${nom}`);
    })
    .catch((err) => {
      console.error(`  ÉCHEC — ${nom}\n    ${err.stack}`);
      process.exitCode = 1;
    });
}

function auditEntry(overrides) {
  return { changes: [], reason: null, extra: {}, ...overrides };
}

async function main() {
  console.log("Seuils :");

  await cas("un seul événement ne déclenche pas un guard 'en rafale' (seuil 3)", async () => {
    const attacker = fakeMember({ id: "attacker-1" });
    const guild = fakeGuild({ members: [attacker] });
    const client = { user: { id: BOT_ID } };
    await checkAuditEntry(client, guild, auditEntry({ action: AuditLogEvent.ChannelCreate, executorId: attacker.id, targetId: "c1" }));
    assert.ok(!attacker.timedOut, "l'attaquant n'aurait pas dû être sanctionné après un seul événement");
  });

  await cas("le seuil atteint (3 en rafale) déclenche la sanction", async () => {
    const attacker = fakeMember({ id: "attacker-2" });
    const guild = fakeGuild({ members: [attacker] });
    const client = { user: { id: BOT_ID } };
    for (let i = 0; i < 3; i++) {
      await checkAuditEntry(client, guild, auditEntry({ action: AuditLogEvent.ChannelCreate, executorId: attacker.id, targetId: `c${i}` }));
    }
    assert.ok(attacker.timedOut, "l'attaquant aurait dû être mis en timeout au 3e événement");
  });

  await cas("une action immédiate (antibot) déclenche dès la première fois", async () => {
    const attacker = fakeMember({ id: "attacker-3" });
    const guild = fakeGuild({ members: [attacker] });
    const client = { user: { id: BOT_ID } };
    await checkAuditEntry(client, guild, auditEntry({ action: AuditLogEvent.BotAdd, executorId: attacker.id, targetId: "newbot" }));
    assert.ok(attacker.timedOut, "antibot doit sanctionner dès la première occurrence");
  });

  console.log("\nExemptions complètes (pas seulement la sanction) :");

  await cas("le propriétaire du serveur n'est jamais sanctionné, même en rafale", async () => {
    const owner = fakeMember({ id: "server-owner" });
    const guild = fakeGuild({ ownerId: "server-owner", members: [owner] });
    const client = { user: { id: BOT_ID } };
    for (let i = 0; i < 5; i++) {
      await checkAuditEntry(client, guild, auditEntry({ action: AuditLogEvent.ChannelDelete, executorId: owner.id, targetId: `c${i}` }));
    }
    assert.ok(!owner.timedOut && !owner.kicked && !owner.banned, "le propriétaire ne doit jamais être sanctionné");
  });

  await cas("le rang sys n'est jamais sanctionné", async () => {
    accessStore.add("sys", "sys-user-1");
    const sysMember = fakeMember({ id: "sys-user-1" });
    const guild = fakeGuild({ members: [sysMember] });
    const client = { user: { id: BOT_ID } };
    for (let i = 0; i < 5; i++) {
      await checkAuditEntry(client, guild, auditEntry({ action: AuditLogEvent.RoleDelete, executorId: sysMember.id, targetId: `r${i}` }));
    }
    assert.ok(!sysMember.timedOut, "le rang sys ne doit jamais être sanctionné");
  });

  await cas("un membre whitelisté n'est jamais sanctionné", async () => {
    const wl = fakeMember({ id: "whitelisted-1" });
    guardWhitelist.add(GUILD_ID, "users", wl.id);
    const guild = fakeGuild({ members: [wl] });
    const client = { user: { id: BOT_ID } };
    for (let i = 0; i < 5; i++) {
      await checkAuditEntry(client, guild, auditEntry({ action: AuditLogEvent.RoleCreate, executorId: wl.id, targetId: `r${i}` }));
    }
    assert.ok(!wl.timedOut, "un membre whitelisté ne doit jamais être sanctionné");
  });

  await cas("le bot ne se sanctionne jamais lui-même", async () => {
    const guild = fakeGuild({ members: [] });
    const client = { user: { id: BOT_ID } };
    // Ne doit même pas planter en tentant de fetch/sanctionner le bot.
    for (let i = 0; i < 5; i++) {
      await checkAuditEntry(client, guild, auditEntry({ action: AuditLogEvent.ChannelCreate, executorId: BOT_ID, targetId: `c${i}` }));
    }
  });

  console.log("\nRestauration (annulation) :");

  await cas("antiban débannit automatiquement une fois le seuil de bans atteint", async () => {
    const attacker = fakeMember({ id: "attacker-4" });
    const guild = fakeGuild({ members: [attacker] });
    guild.bans._set.add("victim-1");
    const client = { user: { id: BOT_ID } };
    for (let i = 0; i < 3; i++) {
      await checkAuditEntry(
        client,
        guild,
        auditEntry({ action: AuditLogEvent.MemberBanAdd, executorId: attacker.id, targetId: "victim-1" })
      );
    }
    assert.ok(!guild.bans._set.has("victim-1"), "la victime aurait dû être débannie automatiquement");
  });

  console.log("\nPlafond de sanctions :");

  await cas("le plafond de sanctions par minute est respecté (pas de rafale de sanctions du bot lui-même)", async () => {
    const client = { user: { id: BOT_ID } };
    const guild = fakeGuild({ id: "guild-cap-test", members: [] });
    let sanctionsAppliquees = 0;
    // 8 attaquants différents sur un serveur NEUF (ID dédié, aucune sanction
    // préalable ce test-ci) : chacun déclenche un guard immédiat (antibot).
    // Sans plafond, les 8 seraient sanctionnés — le plafond (5/minute) doit
    // en bloquer au moins un.
    for (let i = 0; i < 8; i++) {
      const attacker = fakeMember({ id: `flood-attacker-${i}` });
      attacker.guild = guild;
      guild.members.cache.set(attacker.id, attacker);
      await checkAuditEntry(client, guild, auditEntry({ action: AuditLogEvent.BotAdd, executorId: attacker.id, targetId: `bot${i}` }));
      if (attacker.timedOut) sanctionsAppliquees++;
    }
    assert.ok(
      sanctionsAppliquees < 8,
      `le plafond aurait dû bloquer au moins une sanction sur les 8 tentatives, ${sanctionsAppliquees} appliquées`
    );
  });

  console.log("\nAfflux de joins (antijoin) :");

  await cas("un afflux de joins (5 en 10s) provoque l'expulsion", async () => {
    const guild = fakeGuild({ members: [] });
    const client = { user: { id: BOT_ID } };
    let dernier = null;
    for (let i = 0; i < 5; i++) {
      dernier = fakeMember({ id: `joiner-${i}` });
      dernier.guild = guild;
      await checkJoinFlood(client, dernier);
    }
    assert.ok(dernier.kicked, "le dernier arrivant d'un afflux suspect aurait dû être expulsé");
  });

  console.log("\nDésactivation d'un guard précis (panel > Anti-nuke) :");

  await cas("un guard désactivé individuellement ne se déclenche plus, même seuil atteint", async () => {
    const attacker = fakeMember({ id: "attacker-5" });
    const guild = fakeGuild({ id: "guild-single-toggle", members: [attacker] });
    guardConfig.toggleGuard("guild-single-toggle", "antichannel"); // l'anti-nuke reste activé globalement
    const client = { user: { id: BOT_ID } };
    for (let i = 0; i < 5; i++) {
      await checkAuditEntry(client, guild, auditEntry({ action: AuditLogEvent.ChannelCreate, executorId: attacker.id, targetId: `c${i}` }));
    }
    assert.ok(!attacker.timedOut, "antichannel désactivé individuellement ne doit plus sanctionner");
  });

  await cas("les autres guards restent actifs quand un seul est désactivé", async () => {
    const attacker = fakeMember({ id: "attacker-6" });
    const guild = fakeGuild({ id: "guild-single-toggle", members: [attacker] }); // même guilde que le test précédent : antichannel toujours désactivé dessus
    const client = { user: { id: BOT_ID } };
    await checkAuditEntry(client, guild, auditEntry({ action: AuditLogEvent.BotAdd, executorId: attacker.id, targetId: "newbot" }));
    assert.ok(attacker.timedOut, "antibot doit rester actif même si antichannel est désactivé sur ce serveur");
  });

  console.log("\nSanction par module (chaque guard sa propre sanction) :");

  await cas("un guard avec sanction propre \"ban\" bannit (au lieu du timeout global)", async () => {
    const attacker = fakeMember({ id: "attacker-sanction-1" });
    const guild = fakeGuild({ id: "guild-sanction-1", members: [attacker] });
    guardConfig.setGuardPunishment("guild-sanction-1", "antibot", "ban");
    const client = { user: { id: BOT_ID } };
    await checkAuditEntry(client, guild, auditEntry({ action: AuditLogEvent.BotAdd, executorId: attacker.id, targetId: "newbot" }));
    assert.ok(attacker.banned, "antibot avec sanction propre 'ban' aurait dû bannir");
    assert.ok(!attacker.timedOut, "la sanction globale (timeout) ne doit PAS s'appliquer");
  });

  await cas("un guard avec sanction propre \"derank\" retire les rôles (setRoles([]))", async () => {
    const attacker = fakeMember({ id: "attacker-sanction-2" });
    const guild = fakeGuild({ id: "guild-sanction-2", members: [attacker] });
    guardConfig.setGuardPunishment("guild-sanction-2", "antibot", "derank");
    const client = { user: { id: BOT_ID } };
    await checkAuditEntry(client, guild, auditEntry({ action: AuditLogEvent.BotAdd, executorId: attacker.id, targetId: "newbot" }));
    assert.ok(attacker.deranked, "antibot avec sanction propre 'derank' aurait dû retirer les rôles");
    assert.ok(!attacker.banned && !attacker.timedOut, "aucune autre sanction ne doit s'appliquer");
  });

  await cas("un guard SANS sanction propre garde la sanction globale (timeout)", async () => {
    const attacker = fakeMember({ id: "attacker-sanction-3" });
    const guild = fakeGuild({ id: "guild-sanction-3", members: [attacker] });
    guardConfig.setGuardPunishment("guild-sanction-3", "antibot", "ban"); // sur un AUTRE guard
    const client = { user: { id: BOT_ID } };
    // antikick (rafale) n'a pas de sanction propre -> globale (timeout par défaut)
    for (let i = 0; i < 3; i++) {
      await checkAuditEntry(client, guild, auditEntry({ action: AuditLogEvent.MemberKick, executorId: attacker.id, targetId: `v${i}` }));
    }
    assert.ok(attacker.timedOut, "antikick sans sanction propre doit utiliser la sanction globale (timeout)");
    assert.ok(!attacker.banned, "la sanction propre d'antibot ne doit pas déteindre sur antikick");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
}

main();
