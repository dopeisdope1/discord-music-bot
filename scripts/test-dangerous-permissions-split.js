/**
 * Vérifie que TOUTES les commandes "toute la portée du serveur d'un coup"
 * (&unbanall, &hideall/&unhideall, &unmuteall, &voicemove/&bringall) ne sont
 * PLUS débloquées par la même permission que leur équivalent ciblé (&unban,
 * &hide/&unhide, &untimeout/&unmute, &voicekick) — signalé : accorder juste
 * "&ban"/"&unban" à un rôle donnait accès de facto au débannissement de
 * masse (et pareil pour hide/mute/vocal), bien plus dangereux qu'une action
 * ciblée.
 *
 * Lancement : node scripts/test-dangerous-permissions-split.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dangeroussplit-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionFlagsBits } = require("discord.js");
const permStore = require("../utils/permissions/store");
const permCatalog = require("../utils/permissions/catalog");
const serverExtra = require("../utils/serverExtra");
const moderationExtra = require("../utils/moderationExtra");

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

function fakeGuild() {
  return {
    id: "g1",
    roles: { everyone: { id: "everyone" }, cache: new Collection() },
    channels: { cache: new Collection() },
    members: { me: { permissions: { has: () => true } } },
    bans: { fetch: async () => new Collection([["u1", { user: { id: "u1" } }]]) },
  };
}

// Un seul objet guild PARTAGÉ entre le membre et le message : can() lit
// member.guild.id, il doit correspondre à message.guild pour que
// getRoleGrants/getUserGrants retrouvent les octrois sur "g1".
function fakeMemberFor(roleId, guild, id = "membre-1") {
  return {
    id,
    guild,
    roles: { cache: new Collection(roleId ? [[roleId, { id: roleId }]] : []) },
    voice: { channel: null },
  };
}

function fakeMessage(member) {
  const replies = [];
  return {
    author: { id: member.id, tag: "membre#0001" },
    member,
    guild: member.guild,
    channel: { id: "c1" },
    mentions: { channels: new Collection() },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

(async () => {
  console.log("Catalogue — les deux nouvelles clés existent et ne sont pas octroyables par rôle :");

  await cas("moderation.unbanall existe, distincte de moderation.unban, jamais octroyable par rôle", () => {
    const entry = permCatalog.byCategory().flatMap((g) => g.permissions).find((p) => p.key === "moderation.unbanall");
    assert.ok(entry, "moderation.unbanall doit exister dans le catalogue");
    assert.strictEqual(entry.roleGrantable, false);
  });

  await cas("channels.manageall existe, distincte de channels.manage", () => {
    const entry = permCatalog.byCategory().flatMap((g) => g.permissions).find((p) => p.key === "channels.manageall");
    assert.ok(entry, "channels.manageall doit exister dans le catalogue");
  });

  console.log("\n&unbanall — plus débloquée par moderation.unban seul :");

  await cas("un rôle avec UNIQUEMENT moderation.unban ne débloque PAS &unbanall", async () => {
    const guild = fakeGuild();
    const roleId = "role-unban-only";
    permStore.setRoleGrants("g1", roleId, ["moderation.unban"]);
    const member = fakeMemberFor(roleId, guild);
    const msg = fakeMessage(member);
    await serverExtra.unbanall(null, msg);
    assert.strictEqual(msg._replies.length, 0, "aucune réponse : &unban seul ne doit pas débloquer &unbanall");
  });

  await cas("moderation.unbanall n'est PAS octroyable par rôle (comme moderation.banall) — seul un octroi individuel marche", async () => {
    // isRoleGrantable(key) coupe court dans utils/permissions/engine.js
    // AVANT même de regarder les rôles : un octroi PAR RÔLE sur cette clé
    // ne doit jamais débloquer la commande, contrairement à un octroi
    // individuel (accordé directement à la personne, pas à un rôle).
    const guild = fakeGuild();
    const roleId = "role-unbanall-tentative";
    permStore.setRoleGrants("g1", roleId, ["moderation.unbanall"]);
    const viaRole = fakeMemberFor(roleId, guild);
    const msgViaRole = fakeMessage(viaRole);
    await serverExtra.unbanall(null, msgViaRole);
    assert.strictEqual(msgViaRole._replies.length, 0, "un octroi PAR RÔLE ne doit jamais débloquer moderation.unbanall");

    const memberDirect = fakeMemberFor(null, guild, "membre-direct");
    permStore.grantToUser("g1", memberDirect.id, "moderation.unbanall");
    const msgDirect = fakeMessage(memberDirect);
    await serverExtra.unbanall(null, msgDirect);
    assert.strictEqual(msgDirect._replies.length, 1, "un octroi INDIVIDUEL débloque bien la commande");
  });

  console.log("\n&hideall/&unhideall — plus débloquées par channels.manage seul :");

  await cas("un rôle avec UNIQUEMENT channels.manage ne débloque PAS &hideall", async () => {
    const guild = fakeGuild();
    const roleId = "role-manage-only";
    permStore.setRoleGrants("g1", roleId, ["channels.manage"]);
    const member = fakeMemberFor(roleId, guild);
    const msg = fakeMessage(member);
    await moderationExtra.hideall(null, msg);
    assert.strictEqual(msg._replies.length, 0, "aucune réponse : &hide/&unhide seuls ne doivent pas débloquer &hideall");
  });

  await cas("un rôle avec UNIQUEMENT channels.manage ne débloque pas non plus &unhideall", async () => {
    const guild = fakeGuild();
    const roleId = "role-manage-only-2";
    permStore.setRoleGrants("g1", roleId, ["channels.manage"]);
    const member = fakeMemberFor(roleId, guild);
    const msg = fakeMessage(member);
    await moderationExtra.unhideall(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("un rôle avec channels.manageall débloque bien &hideall/&unhideall", async () => {
    const guild = fakeGuild();
    const roleId = "role-manageall";
    permStore.setRoleGrants("g1", roleId, ["channels.manageall"]);
    const member = fakeMemberFor(roleId, guild);
    const msg1 = fakeMessage(member);
    await moderationExtra.hideall(null, msg1);
    assert.strictEqual(msg1._replies.length, 1, "channels.manageall doit débloquer &hideall");
    const msg2 = fakeMessage(member);
    await moderationExtra.unhideall(null, msg2);
    assert.strictEqual(msg2._replies.length, 1, "channels.manageall doit débloquer &unhideall");
  });

  console.log("\n&unmuteall — plus débloquée par moderation.timeout seul :");

  await cas("un rôle avec UNIQUEMENT moderation.timeout ne débloque PAS &unmuteall", async () => {
    const guild = fakeGuild();
    const roleId = "role-timeout-only";
    permStore.setRoleGrants("g1", roleId, ["moderation.timeout"]);
    const member = fakeMemberFor(roleId, guild);
    const msg = fakeMessage(member);
    await moderationExtra.unmuteall(null, msg);
    assert.strictEqual(msg._replies.length, 0, "aucune réponse : &timeout/&untimeout seuls ne doivent pas débloquer &unmuteall");
  });

  await cas("un rôle avec moderation.unmuteall débloque bien &unmuteall (au-delà du gate de permission)", async () => {
    const guild = fakeGuild();
    const roleId = "role-unmuteall";
    permStore.setRoleGrants("g1", roleId, ["moderation.unmuteall"]);
    const member = fakeMemberFor(roleId, guild);
    const msg = fakeMessage(member);
    await moderationExtra.unmuteall(null, msg);
    // Pas de rôle de mute configuré dans ce fixture -> requireMuteRole
    // répond sa propre erreur, ATTEINTE seulement si le gate de permission
    // a été franchi (sinon 0 réponse, comme le cas ci-dessus).
    assert.strictEqual(msg._replies.length, 1, "moderation.unmuteall doit débloquer la commande");
  });

  console.log("\n&voicemove/&bringall — plus débloquées par server.voice.manage seul :");

  await cas("un rôle avec UNIQUEMENT server.voice.manage ne débloque PAS &voicemove", async () => {
    const guild = fakeGuild();
    const roleId = "role-voice-manage-only";
    permStore.setRoleGrants("g1", roleId, ["server.voice.manage"]);
    const member = fakeMemberFor(roleId, guild);
    const msg = fakeMessage(member);
    await serverExtra.voicemove(null, msg);
    assert.strictEqual(msg._replies.length, 0, "aucune réponse : &voicekick/&voicehub seuls ne doivent pas débloquer &voicemove");
  });

  await cas("un rôle avec UNIQUEMENT server.voice.manage ne débloque pas non plus &bringall", async () => {
    const guild = fakeGuild();
    const roleId = "role-voice-manage-only-2";
    permStore.setRoleGrants("g1", roleId, ["server.voice.manage"]);
    const member = fakeMemberFor(roleId, guild);
    const msg = fakeMessage(member);
    await serverExtra.bringall(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("un rôle avec server.voice.moveall débloque bien &voicemove/&bringall", async () => {
    const guild = fakeGuild();
    const roleId = "role-voice-moveall";
    permStore.setRoleGrants("g1", roleId, ["server.voice.moveall"]);
    const member = fakeMemberFor(roleId, guild);
    const msg1 = fakeMessage(member);
    await serverExtra.voicemove(null, msg1);
    assert.strictEqual(msg1._replies.length, 1, "server.voice.moveall doit débloquer &voicemove");
    const msg2 = fakeMessage(member);
    await serverExtra.bringall(null, msg2);
    assert.strictEqual(msg2._replies.length, 1, "server.voice.moveall doit débloquer &bringall");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
