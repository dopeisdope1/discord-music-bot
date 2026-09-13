/**
 * "&mutelist" (utils/moderationExtra.js) — état RÉEL actuel des sanctions
 * "mute" : le rôle de mute (avec échéance des mutes temporaires, voir
 * utils/muteStore.js) ET les timeouts Discord natifs en cours, chacun avec
 * qui l'a posé et depuis quand (utils/moderationHistoryStore.js, même
 * source que &case/&modlogs). Demande explicite (capture d'un autre bot,
 * juste la FONCTION reprise — pas de "deafen" inventé, ça n'existe pas ici).
 *
 * Lancement : node scripts/test-mutelist.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mutelist-test-"));
process.env.BOT_OWNER_IDS = "";

const { Collection } = require("discord.js");
const moderationExtra = require("../utils/moderationExtra");
const muteStore = require("../utils/muteStore");
const historyStore = require("../utils/moderationHistoryStore");
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

const ROLE = "role-mute-1";

function fakeMember(id, { communicationDisabledUntil = null } = {}) {
  return { id, communicationDisabledUntil };
}

function fakeMessage({ guildId = "g1", authorId = "staff-1", roleMembers = [], cacheMembers = [] } = {}) {
  const replies = [];
  const roleMembersCollection = new Collection(roleMembers.map((m) => [m.id, m]));
  return {
    author: { id: authorId },
    guild: {
      id: guildId,
      roles: { cache: new Collection([[ROLE, { id: ROLE, members: roleMembersCollection }]]) },
      members: { cache: new Collection(cacheMembers.map((m) => [m.id, m])) },
    },
    member: { id: authorId, guild: { id: guildId }, roles: { cache: new Collection() } },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

const texteDe = (payload) => JSON.stringify(payload.components);

(async () => {
  console.log("&mutelist — accès :");

  await cas("sans moderation.timeout, silence", async () => {
    const msg = fakeMessage({ guildId: "g-refus", authorId: "quidam-1" });
    await moderationExtra.mutelist(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  console.log("\n&mutelist — rôle de mute non configuré :");

  await cas("sans rôle de mute configuré, le dit clairement", async () => {
    permStore.grantToUser("g-norole", "staff-1", "moderation.timeout");
    const msg = fakeMessage({ guildId: "g-norole", authorId: "staff-1" });
    msg.guild.roles.cache.clear();
    await moderationExtra.mutelist(null, msg);
    const texte = texteDe(msg._replies[0]);
    assert.ok(texte.includes("Aucun rôle de mute configuré"), texte);
  });

  console.log("\n&mutelist — mutes par rôle, avec qui/quand/échéance :");

  await cas("un mute SANS historique affiche « origine inconnue »", async () => {
    permStore.grantToUser("g-anon", "staff-1", "moderation.timeout");
    muteStore.setMuteRoleId("g-anon", ROLE);
    const msg = fakeMessage({ guildId: "g-anon", authorId: "staff-1", roleMembers: [fakeMember("u1")] });
    await moderationExtra.mutelist(null, msg);
    const texte = texteDe(msg._replies[0]);
    assert.ok(texte.includes("origine inconnue"), texte);
    assert.ok(texte.includes("démute manuel"), texte);
  });

  await cas("un mute AVEC historique affiche le modérateur et depuis quand", async () => {
    permStore.grantToUser("g-hist", "staff-1", "moderation.timeout");
    muteStore.setMuteRoleId("g-hist", ROLE);
    historyStore.record({ guildId: "g-hist", action: "mute", targetId: "u2", moderatorId: "mod-1", moderatorTag: "Modo#0001" });
    const msg = fakeMessage({ guildId: "g-hist", authorId: "staff-1", roleMembers: [fakeMember("u2")] });
    await moderationExtra.mutelist(null, msg);
    const texte = texteDe(msg._replies[0]);
    assert.ok(texte.includes("Modo#0001"), texte);
  });

  await cas("&cmute compte comme &mute pour retrouver le modérateur", async () => {
    permStore.grantToUser("g-cmute", "staff-1", "moderation.timeout");
    muteStore.setMuteRoleId("g-cmute", ROLE);
    historyStore.record({ guildId: "g-cmute", action: "cmute", targetId: "u3", moderatorId: "mod-2", moderatorTag: "Modo2#0001" });
    const msg = fakeMessage({ guildId: "g-cmute", authorId: "staff-1", roleMembers: [fakeMember("u3")] });
    await moderationExtra.mutelist(null, msg);
    const texte = texteDe(msg._replies[0]);
    assert.ok(texte.includes("Modo2#0001"), texte);
  });

  await cas("un mute TEMPORAIRE affiche son échéance, un mute permanent dit « démute manuel »", async () => {
    permStore.grantToUser("g-temp", "staff-1", "moderation.timeout");
    muteStore.setMuteRoleId("g-temp", ROLE);
    muteStore.addTempMute("g-temp", "u4", Date.now() + 3_600_000);
    const msg = fakeMessage({ guildId: "g-temp", authorId: "staff-1", roleMembers: [fakeMember("u4"), fakeMember("u5")] });
    await moderationExtra.mutelist(null, msg);
    const texte = texteDe(msg._replies[0]);
    assert.ok(texte.includes("u4") && /expire/.test(texte), texte);
    assert.ok(texte.includes("démute manuel"), texte);
  });

  console.log("\n&mutelist — timeouts Discord natifs :");

  await cas("un timeout EN COURS apparaît, un timeout EXPIRÉ n'apparaît pas", async () => {
    permStore.grantToUser("g-timeout", "staff-1", "moderation.timeout");
    const enCours = fakeMember("u6", { communicationDisabledUntil: new Date(Date.now() + 600_000) });
    const expire = fakeMember("u7", { communicationDisabledUntil: new Date(Date.now() - 600_000) });
    historyStore.record({ guildId: "g-timeout", action: "timeout", targetId: "u6", moderatorId: "mod-3", moderatorTag: "Modo3#0001" });
    const msg = fakeMessage({ guildId: "g-timeout", authorId: "staff-1", cacheMembers: [enCours, expire] });
    await moderationExtra.mutelist(null, msg);
    const texte = texteDe(msg._replies[0]);
    assert.ok(texte.includes("u6") && texte.includes("Modo3#0001"), texte);
    assert.ok(!texte.includes("u7"), texte);
  });

  console.log("\n&mutelist — compteur total :");

  await cas("le total additionne mutes par rôle ET timeouts", async () => {
    permStore.grantToUser("g-total", "staff-1", "moderation.timeout");
    muteStore.setMuteRoleId("g-total", ROLE);
    const msg = fakeMessage({
      guildId: "g-total",
      authorId: "staff-1",
      roleMembers: [fakeMember("u8"), fakeMember("u9")],
      cacheMembers: [fakeMember("u10", { communicationDisabledUntil: new Date(Date.now() + 600_000) })],
    });
    await moderationExtra.mutelist(null, msg);
    const texte = texteDe(msg._replies[0]);
    assert.ok(texte.includes("**3** fiche(s) active(s)"), texte);
  });

  await cas("rien du tout : les deux rubriques le disent clairement, total à 0", async () => {
    permStore.grantToUser("g-vide", "staff-1", "moderation.timeout");
    muteStore.setMuteRoleId("g-vide", ROLE);
    const msg = fakeMessage({ guildId: "g-vide", authorId: "staff-1" });
    await moderationExtra.mutelist(null, msg);
    const texte = texteDe(msg._replies[0]);
    assert.ok(texte.includes("**0** fiche(s) active(s)"), texte);
    assert.ok(texte.includes("Personne n'est mute actuellement"), texte);
    assert.ok(texte.includes("Aucun timeout en cours"), texte);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
