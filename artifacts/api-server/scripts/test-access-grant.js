/**
 * "=owner <@membre>" (utils/serverAdminCommands.js::
 * handleAddAccessTextCommand) bascule tous les accès du préfixe "=" :
 * l'opération accorde les clés vocales manquantes, puis les retire toutes au
 * clic suivant. "=add <@membre>" conserve la carte "Owner" VOCALE granulaire
 * (buildVoiceOwnerCard) et ses interactions srv:voiceowner.
 *
 * Lancement : node scripts/test-access-grant.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "voice-owner-test-"));
process.env.BOT_OWNER_IDS = "";

const { Collection, PermissionsBitField, ChannelType } = require("discord.js");
const serverAdmin = require("../utils/serverAdminCommands");
const serverExtra = require("../utils/serverExtra");
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

const TARGET = "999888777000111222";
const GLOBAL_OWNER = "888777666555444333";
const SYS_TARGET = "777666555444333222";

function fakeGuild(id, { hasTarget = true, targetId = TARGET, targetTag = "cible#0001" } = {}) {
  const targetMember = { id: targetId, user: { id: targetId, tag: targetTag } };
  return { id, members: { fetch: async (uid) => (hasTarget && uid === targetId ? targetMember : null) } };
}

function fakeMessage({ guildId = "g1", authorId = "staff-1", content, hasTarget = true, targetId = TARGET, targetTag } = {}) {
  const replies = [];
  const guild = fakeGuild(guildId, { hasTarget, targetId, targetTag });
  return {
    content,
    author: { id: authorId, bot: false, tag: `${authorId}#0000` },
    guild,
    member: { id: authorId, guild, roles: { cache: new Collection() } },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

function fakeInteraction(customId, { userId = "staff-1", guildId = "g1", values } = {}) {
  const updates = [];
  const replies = [];
  const guild = fakeGuild(guildId);
  return {
    customId,
    guild,
    user: { id: userId, tag: `${userId}#0000` },
    member: { id: userId, guild, roles: { cache: new Collection() } },
    values,
    update: async (p) => updates.push(p),
    reply: async (p) => replies.push(p),
    deferUpdate: async () => {},
    _updates: updates,
    _replies: replies,
  };
}

(async () => {
  console.log("Préfixe dédié \"=\" :");

  await cas("le préfixe par défaut est \"=\", distinct de \"&\" et \"!!\"", () => {
    const { owner, musicMod, protection } = getPrefixes("g-quelconque");
    assert.strictEqual(owner, "=");
    assert.notStrictEqual(owner, musicMod);
    assert.notStrictEqual(owner, protection);
  });

  console.log("\n\"=owner\" — bascule de tout l'accès vocal du préfixe \"=\" :");

  await cas("sans panel.permissions.manage, silence", async () => {
    const msg = fakeMessage({ guildId: "g1", authorId: "u1", content: `=owner <@${TARGET}>` });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("cible absente du serveur", async () => {
    permStore.grantToUser("g2", "staff-2", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g2", authorId: "staff-2", content: `=owner <@${TARGET}>`, hasTarget: false });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 1);
    assert.ok(JSON.stringify(msg._replies[0]).includes("pas sur le serveur"));
  });

  await cas("cible invalide ou absente, rappelle la syntaxe", async () => {
    permStore.grantToUser("g-invalid", "staff-invalid", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g-invalid", authorId: "staff-invalid", content: "=owner pas-un-membre" });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    assert.ok(JSON.stringify(msg._replies[0]).includes("owner @membre"));
  });

  await cas("\"=owner\" accorde toutes les clés vocales manquantes", async () => {
    const { VOICE_ACCESS_KEYS } = require("../utils/voiceAccess");
    permStore.grantToUser("g3", "staff-3", "panel.permissions.manage");
    permStore.grantToUser("g3", TARGET, "voice.mute");
    permStore.grantToUser("g3", TARGET, "permission.sans-rapport");
    const msg = fakeMessage({ guildId: "g3", authorId: "staff-3", content: `=owner <@${TARGET}>` });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    assert.deepStrictEqual(
      new Set(permStore.getUserGrants("g3", TARGET)),
      new Set(["permission.sans-rapport", ...VOICE_ACCESS_KEYS])
    );
    assert.ok(JSON.stringify(msg._replies[0]).includes("intégralité du préfixe"));
  });

  await cas("\"=owner\" révoque toutes les clés vocales et conserve les accès sans rapport", async () => {
    const { VOICE_ACCESS_KEYS } = require("../utils/voiceAccess");
    permStore.grantToUser("g4", "staff-4", "panel.permissions.manage");
    for (const key of VOICE_ACCESS_KEYS) permStore.grantToUser("g4", TARGET, key);
    permStore.grantToUser("g4", TARGET, "permission.sans-rapport");
    const msg = fakeMessage({ guildId: "g4", authorId: "staff-4", content: `=owner <@${TARGET}>` });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    assert.deepStrictEqual(permStore.getUserGrants("g4", TARGET), ["permission.sans-rapport"]);
    assert.ok(JSON.stringify(msg._replies[0]).includes("accès complet"));
    assert.ok(JSON.stringify(msg._replies[0]).includes("retiré"));
  });

  await cas("une cible BOT_OWNER_IDS ne reçoit aucune permission de préfixe", async () => {
    process.env.BOT_OWNER_IDS = GLOBAL_OWNER;
    permStore.grantToUser("g5", "staff-5", "panel.permissions.manage");
    permStore.grantToUser("g5", GLOBAL_OWNER, "permission.sans-rapport");
    const msg = fakeMessage({ guildId: "g5", authorId: "staff-5", targetId: GLOBAL_OWNER, content: `=owner <@${GLOBAL_OWNER}>` });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    assert.deepStrictEqual(permStore.getUserGrants("g5", GLOBAL_OWNER), ["permission.sans-rapport"]);
    assert.ok(JSON.stringify(msg._replies[0]).includes("propriétaire"));
    process.env.BOT_OWNER_IDS = "";
  });

  await cas("une cible sys ne reçoit aucune permission de préfixe", async () => {
    const accessStore = require("../utils/accessStore");
    accessStore.add("sys", SYS_TARGET);
    permStore.grantToUser("g-sys", "staff-sys", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g-sys", authorId: "staff-sys", targetId: SYS_TARGET, content: `=owner <@${SYS_TARGET}>` });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    assert.deepStrictEqual(permStore.getUserGrants("g-sys", SYS_TARGET), []);
    assert.ok(JSON.stringify(msg._replies[0]).includes("rang sys"));
    accessStore.remove("sys", SYS_TARGET);
  });

  await cas("\"=add\" conserve la carte granulaire et srv:voiceowner", async () => {
    permStore.grantToUser("g6", "staff-6", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g6", authorId: "staff-6", content: `=add <@${TARGET}>` });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    const texte = JSON.stringify(msg._replies[0].components);
    assert.ok(texte.includes("## Owner") && texte.includes("srv:voiceowner"), texte);
    assert.ok(texte.includes(`"value":"voice.mute"`), texte);
  });

  await cas("sans argument, rappelle SA syntaxe", async () => {
    permStore.grantToUser("g6", "staff-6", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g6", authorId: "staff-6", content: "=owner" });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    assert.ok(JSON.stringify(msg._replies[0]).includes("owner @membre"));
  });

  console.log("\nInteraction \"srv:voiceowner\" — cocher/décocher un accès :");

  await cas("cocher un accès l'accorde vraiment (permStore voice.<cmd>) et l'affiche dans la liste", async () => {
    permStore.grantToUser("g7", "staff-7", "panel.permissions.manage");
    const interaction = fakeInteraction(`srv:voiceowner:${TARGET}`, { userId: "staff-7", guildId: "g7", values: ["voice.wakeup"] });
    await serverAdmin.handleServerAdminInteraction(interaction);
    assert.ok(permStore.getUserGrants("g7", TARGET).includes("voice.wakeup"));
    const texte = JSON.stringify(interaction._updates[0].components);
    assert.ok(texte.includes("Accès attribués — 1"), texte);
    assert.ok(texte.includes("wakeup"), texte);
  });

  await cas("chaque option porte ✓ (accordée) ou ✗ (non accordée)", async () => {
    permStore.grantToUser("g8", "staff-8", "panel.permissions.manage");
    permStore.grantToUser("g8", TARGET, "voice.mute");
    const interaction = fakeInteraction(`srv:voiceowner:${TARGET}`, { userId: "staff-8", guildId: "g8", values: ["voice.deaf"] });
    // toggle voice.deaf on, puis on inspecte la carte
    await serverAdmin.handleServerAdminInteraction(interaction);
    const serialise = JSON.parse(JSON.stringify(interaction._updates[0]));
    const options = serialise.components[0].components.at(-1).components[0].options;
    const mute = options.find((o) => o.value === "voice.mute");
    const undeaf = options.find((o) => o.value === "voice.undeaf");
    assert.strictEqual(mute.emoji?.name, "CheckMark");
    assert.strictEqual(undeaf.emoji?.name, "crossemoji");
  });

  await cas("re-cocher un accès déjà accordé le retire (bascule)", async () => {
    permStore.grantToUser("g9", "staff-9", "panel.permissions.manage");
    permStore.grantToUser("g9", TARGET, "voice.find");
    const interaction = fakeInteraction(`srv:voiceowner:${TARGET}`, { userId: "staff-9", guildId: "g9", values: ["voice.find"] });
    await serverAdmin.handleServerAdminInteraction(interaction);
    assert.ok(!permStore.getUserGrants("g9", TARGET).includes("voice.find"));
  });

  await cas("sans panel.permissions.manage, l'interaction est refusée", async () => {
    const interaction = fakeInteraction(`srv:voiceowner:${TARGET}`, { userId: "sans-perm", guildId: "g10", values: ["voice.mute"] });
    await serverAdmin.handleServerAdminInteraction(interaction);
    assert.strictEqual(interaction._updates.length, 0);
    assert.strictEqual(interaction._replies.length, 1);
  });

  console.log("\nEffet RÉEL de l'accès : un membre non-staff peut utiliser la commande accordée :");

  function fakeVoiceMessage({ guildId, authorId, targetId, targetTag = "cible#0001" }) {
    const replies = [];
    const target = {
      id: targetId,
      user: { id: targetId, tag: targetTag },
      voice: { channel: { id: "vc", type: ChannelType.GuildVoice }, channelId: "vc", disconnect: async function () { this.channel = null; } },
    };
    const guild = {
      id: guildId,
      members: { me: { permissions: new PermissionsBitField(PermissionsBitField.All) }, fetch: async (uid) => (uid === targetId ? target : null) },
    };
    return {
      author: { id: authorId, bot: false, tag: `${authorId}#0000` },
      guild,
      member: { id: authorId, guild, roles: { cache: new Collection() }, permissions: new PermissionsBitField() },
      mentions: { users: new Collection([[targetId, target.user]]), channels: new Collection() },
      reply: async (p) => {
        replies.push(p);
        return {};
      },
      _replies: replies,
      _target: target,
    };
  }

  await cas("SANS accès voice.disconnect, un non-staff ne peut PAS utiliser =disconnect", async () => {
    const msg = fakeVoiceMessage({ guildId: "gv1", authorId: "membre-lambda", targetId: "400000000000000001" });
    await serverExtra.voicekick(null, msg, ["<@400000000000000001>"]);
    assert.strictEqual(msg._replies.length, 0); // silence, refusé
    assert.ok(msg._target.voice.channel); // pas expulsé
  });

  await cas("AVEC accès voice.disconnect accordé, le même non-staff PEUT utiliser =disconnect", async () => {
    permStore.grantToUser("gv2", "membre-lambda", "voice.disconnect");
    const msg = fakeVoiceMessage({ guildId: "gv2", authorId: "membre-lambda", targetId: "400000000000000002" });
    await serverExtra.voicekick(null, msg, ["<@400000000000000002>"]);
    assert.strictEqual(msg._target.voice.channel, null); // expulsé pour de vrai
  });

  await cas("un accès accordé (voice.mute) ne débloque PAS une autre commande (voice.find)", async () => {
    permStore.grantToUser("gv3", "membre-lambda", "voice.mute");
    const msg = fakeVoiceMessage({ guildId: "gv3", authorId: "membre-lambda", targetId: "400000000000000003" });
    await serverExtra.voicefind(null, msg, ["<@400000000000000003>"]);
    assert.strictEqual(msg._replies.length, 0); // find non accordé -> silence
  });

  console.log("\nIsolation préfixe / mot :");

  await cas("mot inconnu sur \"=\" : silence", async () => {
    const msg = fakeMessage({ guildId: "g11", authorId: "staff-11", content: "=nimportequoi" });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("\"&owner\" (mauvais préfixe) ne déclenche pas cette carte vocale", async () => {
    permStore.grantToUser("g12", "staff-12", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g12", authorId: "staff-12", content: `&owner <@${TARGET}>` });
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("message de bot ignoré", async () => {
    permStore.grantToUser("g13", "staff-13", "panel.permissions.manage");
    const msg = fakeMessage({ guildId: "g13", authorId: "staff-13", content: `=owner <@${TARGET}>` });
    msg.author.bot = true;
    await serverAdmin.handleAddAccessTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
