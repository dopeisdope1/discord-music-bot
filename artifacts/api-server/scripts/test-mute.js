/**
 * Vérifie la fusion des mutes :
 *  - &mute <@membre> [durée] [raison] = timeout NATIF Discord (alias
 *    historique &timeout), 28 jours sans durée, refus d'une durée mal tapée ;
 *  - &unmute (alias &untimeout) lève ce timeout, et oriente vers
 *    &permunmute quand le membre porte le rôle de mute ;
 *  - &permmute / &permunmute = rôle de mute, SANS échéance ;
 *  - &unmuteall lève les deux (timeouts ET rôle de mute) ;
 *  - &tempmute / &cmute / &tempcmute / &uncmute n'existent plus.
 *
 * DATA_DIR temporaire : aucune donnée réelle n'est lue ni écrite.
 * Lancement : node scripts/test-mute.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mute-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { modHandlers } = require("../utils/musicCommands");
const muteStore = require("../utils/muteStore");

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

const TARGET_ID = "999888777000111222";
const MUTE_ROLE_ID = "555555555555555555";
const JOUR = 86_400_000;

function makeTarget(id = TARGET_ID) {
  const target = {
    id,
    user: { id, tag: `cible-${id.slice(-3)}#0001` },
    communicationDisabledUntil: null,
    roles: {
      cache: new Collection(),
      highest: { position: 1 },
      add: async (role) => target.roles.cache.set(role.id || role, { id: role.id || role }),
      remove: async (role) => target.roles.cache.delete(role.id || role),
    },
    timeout: async (ms, reason) => {
      target._timeout = { ms, reason };
      target.communicationDisabledUntil = ms ? new Date(Date.now() + ms) : null;
    },
  };
  return target;
}

function makeContext({ targets = [makeTarget()], withMuteRole = true } = {}) {
  const membersCache = new Collection(targets.map((t) => [t.id, t]));
  const muteRole = {
    id: MUTE_ROLE_ID,
    get members() {
      return membersCache.filter((m) => m.roles.cache.has(MUTE_ROLE_ID));
    },
  };
  const guild = {
    id: "g-mute",
    ownerId: "owner-x",
    roles: { cache: new Collection(withMuteRole ? [[MUTE_ROLE_ID, muteRole]] : []) },
    members: {
      me: { id: "bot-1", permissions: new PermissionsBitField(PermissionsBitField.All), roles: { highest: { position: 10 } } },
      fetch: async (id) => membersCache.get(id) || null,
      cache: membersCache,
    },
    channels: { cache: new Collection() },
  };
  if (withMuteRole) muteStore.setMuteRoleId(guild.id, MUTE_ROLE_ID);
  else muteStore.setMuteRoleId(guild.id, null);
  return { guild, muteRole };
}

function makeMessage(guild, args) {
  const replies = [];
  const mentioned = args[0]?.match(/^<@!?(\d+)>$/)?.[1];
  return {
    author: { id: "owner-1", tag: "owner#0001" },
    member: { id: "owner-1", guild, roles: { cache: new Collection(), highest: { position: 9 } }, permissions: new PermissionsBitField() },
    guild,
    channel: { id: "chan-1" },
    mentions: { users: new Collection(mentioned ? [[mentioned, { id: mentioned }]] : []), members: new Collection(), roles: new Collection() },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

const texte = (msg) => {
  const p = msg._replies[0];
  const embed = p?.embeds?.[0];
  return embed?.data?.description || embed?.description || JSON.stringify(p || "");
};
const client = { user: { id: "bot-1", tag: "bot#0001" }, channels: { cache: new Collection(), fetch: async () => null } };

(async () => {
  console.log("&mute (timeout natif) :");

  await cas("&mute avec durée pose un timeout natif de cette durée, sans toucher au rôle de mute", async () => {
    const { guild } = makeContext();
    const target = guild.members.cache.get(TARGET_ID);
    await modHandlers.mute(client, makeMessage(guild, [`<@${TARGET_ID}>`, "10m", "spam"]), [`<@${TARGET_ID}>`, "10m", "spam"]);
    assert.strictEqual(target._timeout.ms, 10 * 60_000);
    assert.strictEqual(target._timeout.reason, "spam");
    assert.ok(!target.roles.cache.has(MUTE_ROLE_ID), "&mute ne doit plus poser le rôle de mute");
  });

  await cas("&mute sans durée = 28 jours (plafond Discord), le reste devient la raison", async () => {
    const { guild } = makeContext();
    const target = guild.members.cache.get(TARGET_ID);
    const msg = makeMessage(guild, [`<@${TARGET_ID}>`, "insultes", "répétées"]);
    await modHandlers.mute(client, msg, [`<@${TARGET_ID}>`, "insultes", "répétées"]);
    assert.strictEqual(target._timeout.ms, 28 * JOUR);
    assert.strictEqual(target._timeout.reason, "insultes répétées");
    assert.ok(texte(msg).includes("28j"), texte(msg));
  });

  await cas("&mute fonctionne même sans rôle de mute configuré", async () => {
    const { guild } = makeContext({ withMuteRole: false });
    const target = guild.members.cache.get(TARGET_ID);
    await modHandlers.mute(client, makeMessage(guild, [`<@${TARGET_ID}>`, "1h"]), [`<@${TARGET_ID}>`, "1h"]);
    assert.strictEqual(target._timeout.ms, 3_600_000);
  });

  await cas("une durée mal tapée (\"10\") est refusée, jamais prise pour 28 jours + raison", async () => {
    const { guild } = makeContext();
    const target = guild.members.cache.get(TARGET_ID);
    const msg = makeMessage(guild, [`<@${TARGET_ID}>`, "10", "min"]);
    await modHandlers.mute(client, msg, [`<@${TARGET_ID}>`, "10", "min"]);
    assert.strictEqual(target._timeout, undefined, "aucun timeout ne doit être posé");
    assert.ok(texte(msg).includes("Durée invalide"), texte(msg));
  });

  await cas("&timeout reste un alias exact de &mute", () => {
    assert.strictEqual(modHandlers.timeout, modHandlers.mute);
    assert.strictEqual(modHandlers.untimeout, modHandlers.unmute);
  });

  console.log("\n&unmute :");

  await cas("&unmute lève le timeout natif", async () => {
    const { guild } = makeContext();
    const target = guild.members.cache.get(TARGET_ID);
    target.communicationDisabledUntil = new Date(Date.now() + JOUR);
    await modHandlers.unmute(client, makeMessage(guild, [`<@${TARGET_ID}>`]), [`<@${TARGET_ID}>`]);
    assert.strictEqual(target._timeout.ms, null);
    assert.strictEqual(target.communicationDisabledUntil, null);
  });

  await cas("&unmute sur un membre au rôle de mute oriente vers &permunmute sans rien retirer", async () => {
    const { guild } = makeContext();
    const target = guild.members.cache.get(TARGET_ID);
    target.roles.cache.set(MUTE_ROLE_ID, { id: MUTE_ROLE_ID });
    const msg = makeMessage(guild, [`<@${TARGET_ID}>`]);
    await modHandlers.unmute(client, msg, [`<@${TARGET_ID}>`]);
    assert.ok(target.roles.cache.has(MUTE_ROLE_ID));
    assert.ok(texte(msg).includes("permunmute"), texte(msg));
  });

  console.log("\n&permmute / &permunmute (rôle de mute, sans échéance) :");

  await cas("&permmute pose le rôle de mute, sans timeout ni échéance enregistrée", async () => {
    const { guild } = makeContext();
    const target = guild.members.cache.get(TARGET_ID);
    await modHandlers.permmute(client, makeMessage(guild, [`<@${TARGET_ID}>`, "raison"]), [`<@${TARGET_ID}>`, "raison"]);
    assert.ok(target.roles.cache.has(MUTE_ROLE_ID));
    assert.strictEqual(target._timeout, undefined);
    assert.deepStrictEqual(muteStore.getTempMutesForGuild(guild.id), []);
  });

  await cas("&permmute exige un rôle de mute configuré", async () => {
    const { guild } = makeContext({ withMuteRole: false });
    const msg = makeMessage(guild, [`<@${TARGET_ID}>`]);
    await modHandlers.permmute(client, msg, [`<@${TARGET_ID}>`]);
    assert.ok(texte(msg).includes("set muterole"), texte(msg));
  });

  await cas("&permunmute retire le rôle de mute", async () => {
    const { guild } = makeContext();
    const target = guild.members.cache.get(TARGET_ID);
    target.roles.cache.set(MUTE_ROLE_ID, { id: MUTE_ROLE_ID });
    await modHandlers.permunmute(client, makeMessage(guild, [`<@${TARGET_ID}>`]), [`<@${TARGET_ID}>`]);
    assert.ok(!target.roles.cache.has(MUTE_ROLE_ID));
  });

  console.log("\n&unmuteall :");

  await cas("&unmuteall lève à la fois les timeouts et le rôle de mute", async () => {
    const aRole = makeTarget("111111111111111111");
    const aTimeout = makeTarget("222222222222222222");
    const { guild } = makeContext({ targets: [aRole, aTimeout] });
    aRole.roles.cache.set(MUTE_ROLE_ID, { id: MUTE_ROLE_ID });
    aTimeout.communicationDisabledUntil = new Date(Date.now() + JOUR);
    const msg = makeMessage(guild, []);
    await modHandlers.unmuteall(client, msg, []);
    assert.ok(!aRole.roles.cache.has(MUTE_ROLE_ID));
    assert.strictEqual(aTimeout._timeout.ms, null);
    assert.ok(texte(msg).includes("**2**"), texte(msg));
  });

  await cas("&unmuteall épargne les mutes &bmute (verrou de grade) et leur entrée reste cohérente", async () => {
    const gradeMuteStore = require("../utils/gradeMuteStore");
    const normal = makeTarget("333333333333333333");
    const grade = makeTarget("444444444444444444");
    const { guild } = makeContext({ targets: [normal, grade] });
    normal.roles.cache.set(MUTE_ROLE_ID, { id: MUTE_ROLE_ID });
    grade.roles.cache.set(MUTE_ROLE_ID, { id: MUTE_ROLE_ID });
    gradeMuteStore.setMute(guild.id, grade.id, { gradeIndex: 3, moderatorId: "chef-1" });

    const msg = makeMessage(guild, []);
    await modHandlers.unmuteall(client, msg, []);
    assert.ok(!normal.roles.cache.has(MUTE_ROLE_ID), "le mute normal est levé");
    assert.ok(grade.roles.cache.has(MUTE_ROLE_ID), "le mute bmute reste en place");
    assert.ok(gradeMuteStore.getMute(guild.id, grade.id), "son entrée de grade n'est pas orpheline");
    assert.ok(texte(msg).includes("bunmute"), texte(msg));
    gradeMuteStore.removeMute(guild.id, grade.id);
  });

  await cas("&permunmute refuse un mute &bmute et renvoie vers &bunmute", async () => {
    const gradeMuteStore = require("../utils/gradeMuteStore");
    const { guild } = makeContext();
    const target = guild.members.cache.get(TARGET_ID);
    target.roles.cache.set(MUTE_ROLE_ID, { id: MUTE_ROLE_ID });
    gradeMuteStore.setMute(guild.id, TARGET_ID, { gradeIndex: 2, moderatorId: "chef-1" });
    const msg = makeMessage(guild, [`<@${TARGET_ID}>`]);
    await modHandlers.permunmute(client, msg, [`<@${TARGET_ID}>`]);
    assert.ok(target.roles.cache.has(MUTE_ROLE_ID), "le rôle ne doit pas être retiré");
    assert.ok(texte(msg).includes("bunmute"), texte(msg));
    gradeMuteStore.removeMute(guild.id, TARGET_ID);
  });

  await cas("&bmuteresetall garde l'entrée quand Discord refuse de retirer le rôle", async () => {
    const gradeMuteStore = require("../utils/gradeMuteStore");
    const ok = makeTarget("666666666666666666");
    const bloque = makeTarget("777777777777777777");
    bloque.roles.remove = async () => {
      throw new Error("Missing Permissions");
    };
    const { guild } = makeContext({ targets: [ok, bloque] });
    for (const t of [ok, bloque]) {
      t.roles.cache.set(MUTE_ROLE_ID, { id: MUTE_ROLE_ID });
      gradeMuteStore.setMute(guild.id, t.id, { gradeIndex: 0, moderatorId: "chef-1" });
    }
    const msg = makeMessage(guild, []);
    await modHandlers.bmuteresetall(client, msg, []);
    assert.strictEqual(gradeMuteStore.getMute(guild.id, ok.id), null, "le mute levé est nettoyé");
    assert.ok(gradeMuteStore.getMute(guild.id, bloque.id), "le mute toujours en place garde son entrée");
    assert.ok(texte(msg).includes("refusé"), texte(msg));
    gradeMuteStore.removeMute(guild.id, bloque.id);
  });

  console.log("\nCommandes retirées :");

  await cas("&tempmute, &cmute, &tempcmute et &uncmute ne sont plus routées", () => {
    for (const nom of ["tempmute", "cmute", "tempcmute", "uncmute"]) {
      assert.strictEqual(modHandlers[nom], undefined, `${nom} ne devrait plus exister`);
    }
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
