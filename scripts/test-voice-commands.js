/**
 * "=lock"/"=unlock"/"=disconnect"/"=mute"/"=unmute"/"=deaf"/"=undeaf"/"=move"
 * (utils/serverAdminCommands.js) — écosystème vocal sur "=". lock/unlock/
 * disconnect délèguent tels quels à vc() (déjà testé dans scripts/test-
 * voice-control.js) ; mute/unmute/deaf/undeaf/move sont de VRAIES nouvelles
 * actions. Toutes gardent le même garde-fou que "&voc" : seul le
 * propriétaire ACTUEL du salon temporaire peut agir, sur SON salon.
 *
 * Lancement : node scripts/test-voice-commands.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "voice-commands-test-"));
process.env.BOT_OWNER_IDS = "";

const { ChannelType } = require("discord.js");
const serverAdmin = require("../utils/serverAdminCommands");
const voiceChannels = require("../utils/voiceChannels");

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

function fakeChannel(id = "vc1") {
  return {
    id,
    type: ChannelType.GuildVoice,
    permissionOverwrites: { edit: async () => {}, delete: async () => {} },
  };
}

function fakeMember(id, channel) {
  return {
    id,
    user: { id, tag: `${id}#0001` },
    voice: {
      channelId: channel?.id || null,
      channel,
      disconnect: async function () {
        this.channelId = null;
      },
      setMute: async function (v) {
        this._mute = v;
      },
      setDeaf: async function (v) {
        this._deaf = v;
      },
      setChannel: async function (channelId) {
        this.channelId = channelId;
      },
    },
  };
}

function fakeMessage({ guildId = "g1", authorId = "owner-1", channel = null, mentionedMember = null } = {}) {
  const replies = [];
  return {
    author: { id: authorId, bot: false, tag: `${authorId}#0000` },
    guild: { id: guildId, roles: { everyone: { id: guildId } } },
    member: fakeMember(authorId, channel),
    mentions: { members: { first: () => mentionedMember } },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

(async () => {
  console.log("\"=lock\"/\"=unlock\"/\"=disconnect\" — délégation directe à vc() :");

  await cas("\"=lock\" verrouille réellement le salon (même mécanisme que &voc lock)", async () => {
    const channel = fakeChannel("vc-lock-1");
    let overwriteApplique = null;
    channel.permissionOverwrites.edit = async (t, p) => (overwriteApplique = p);
    voiceChannels.registerChannel(channel.id, "g1", "owner-1");
    const msg = fakeMessage({ guildId: "g1", authorId: "owner-1", channel });
    await serverAdmin.voiceLock(null, msg, []);
    assert.strictEqual(overwriteApplique?.Connect, false);
  });

  await cas("\"=unlock\" déverrouille réellement le salon", async () => {
    const channel = fakeChannel("vc-lock-2");
    let overwriteApplique = null;
    channel.permissionOverwrites.edit = async (t, p) => (overwriteApplique = p);
    voiceChannels.registerChannel(channel.id, "g2", "owner-2");
    const msg = fakeMessage({ guildId: "g2", authorId: "owner-2", channel });
    await serverAdmin.voiceUnlock(null, msg, []);
    assert.strictEqual(overwriteApplique?.Connect, null);
  });

  await cas("\"=disconnect @membre\" expulse réellement (même mécanisme que &voc kick)", async () => {
    const channel = fakeChannel("vc-disc-1");
    voiceChannels.registerChannel(channel.id, "g3", "owner-3");
    const cible = fakeMember("cible-3", channel);
    const msg = fakeMessage({ guildId: "g3", authorId: "owner-3", channel, mentionedMember: cible });
    await serverAdmin.voiceDisconnect(null, msg, [`<@cible-3>`]);
    assert.strictEqual(cible.voice.channelId, null);
  });

  console.log("\n\"=mute\"/\"=unmute\" — mute vocal Discord natif (PAS le mute-rôle punitif de \"&mute\") :");

  await cas("\"=mute @membre\" mute réellement (voice.setMute(true))", async () => {
    const channel = fakeChannel("vc-mute-1");
    voiceChannels.registerChannel(channel.id, "g4", "owner-4");
    const cible = fakeMember("cible-4", channel);
    const msg = fakeMessage({ guildId: "g4", authorId: "owner-4", channel, mentionedMember: cible });
    await serverAdmin.voiceMute(null, msg, [`<@cible-4>`]);
    assert.strictEqual(cible.voice._mute, true);
  });

  await cas("\"=unmute @membre\" démute réellement", async () => {
    const channel = fakeChannel("vc-mute-2");
    voiceChannels.registerChannel(channel.id, "g5", "owner-5");
    const cible = fakeMember("cible-5", channel);
    const msg = fakeMessage({ guildId: "g5", authorId: "owner-5", channel, mentionedMember: cible });
    await serverAdmin.voiceUnmute(null, msg, [`<@cible-5>`]);
    assert.strictEqual(cible.voice._mute, false);
  });

  await cas("\"=mute\" refuse une cible qui n'est pas dans le salon", async () => {
    const channel = fakeChannel("vc-mute-3");
    voiceChannels.registerChannel(channel.id, "g6", "owner-6");
    const cibleAilleurs = fakeMember("cible-6", fakeChannel("autre-salon"));
    const msg = fakeMessage({ guildId: "g6", authorId: "owner-6", channel, mentionedMember: cibleAilleurs });
    await serverAdmin.voiceMute(null, msg, [`<@cible-6>`]);
    assert.strictEqual(cibleAilleurs.voice._mute, undefined);
    assert.ok(JSON.stringify(msg._replies[0]).includes("n'est pas dans ton salon"));
  });

  console.log("\n\"=deaf\"/\"=undeaf\" — sourdine vocale native :");

  await cas("\"=deaf @membre\" applique réellement la sourdine (voice.setDeaf(true))", async () => {
    const channel = fakeChannel("vc-deaf-1");
    voiceChannels.registerChannel(channel.id, "g7", "owner-7");
    const cible = fakeMember("cible-7", channel);
    const msg = fakeMessage({ guildId: "g7", authorId: "owner-7", channel, mentionedMember: cible });
    await serverAdmin.voiceDeafen(null, msg, [`<@cible-7>`]);
    assert.strictEqual(cible.voice._deaf, true);
  });

  await cas("\"=undeaf @membre\" lève réellement la sourdine", async () => {
    const channel = fakeChannel("vc-deaf-2");
    voiceChannels.registerChannel(channel.id, "g8", "owner-8");
    const cible = fakeMember("cible-8", channel);
    const msg = fakeMessage({ guildId: "g8", authorId: "owner-8", channel, mentionedMember: cible });
    await serverAdmin.voiceUndeafen(null, msg, [`<@cible-8>`]);
    assert.strictEqual(cible.voice._deaf, false);
  });

  console.log("\n\"=move @membre\" — déplace (distinct de \"transfer\"=propriété et \"add\"=accès seul) :");

  await cas("déplace réellement un membre connecté ailleurs sur le serveur", async () => {
    const channel = fakeChannel("vc-move-1");
    voiceChannels.registerChannel(channel.id, "g9", "owner-9");
    const cibleAilleurs = fakeMember("cible-9", fakeChannel("autre-salon-9"));
    const msg = fakeMessage({ guildId: "g9", authorId: "owner-9", channel, mentionedMember: cibleAilleurs });
    await serverAdmin.voiceMove(null, msg, [`<@cible-9>`]);
    assert.strictEqual(cibleAilleurs.voice.channelId, channel.id);
  });

  await cas("refuse un membre non connecté à AUCUN salon vocal", async () => {
    const channel = fakeChannel("vc-move-2");
    voiceChannels.registerChannel(channel.id, "g10", "owner-10");
    const cibleDeconnectee = fakeMember("cible-10", null);
    const msg = fakeMessage({ guildId: "g10", authorId: "owner-10", channel, mentionedMember: cibleDeconnectee });
    await serverAdmin.voiceMove(null, msg, [`<@cible-10>`]);
    assert.strictEqual(cibleDeconnectee.voice.channelId, null);
    assert.ok(JSON.stringify(msg._replies[0]).includes("aucun salon vocal"));
  });

  await cas("déjà dans le salon : message informatif, pas d'erreur", async () => {
    const channel = fakeChannel("vc-move-3");
    voiceChannels.registerChannel(channel.id, "g11", "owner-11");
    const dejaLa = fakeMember("cible-11", channel);
    const msg = fakeMessage({ guildId: "g11", authorId: "owner-11", channel, mentionedMember: dejaLa });
    await serverAdmin.voiceMove(null, msg, [`<@cible-11>`]);
    assert.ok(JSON.stringify(msg._replies[0]).includes("déjà"));
  });

  console.log("\nGarde-fou commun (seul le propriétaire ACTUEL, sur SON salon) :");

  await cas("\"=mute\" refusé pour un invité qui n'est pas le propriétaire", async () => {
    const channel = fakeChannel("vc-garde-1");
    voiceChannels.registerChannel(channel.id, "g12", "vrai-owner-12");
    const cible = fakeMember("cible-12", channel);
    const msg = fakeMessage({ guildId: "g12", authorId: "invite-12", channel, mentionedMember: cible });
    await serverAdmin.voiceMute(null, msg, [`<@cible-12>`]);
    assert.strictEqual(cible.voice._mute, undefined);
    assert.ok(JSON.stringify(msg._replies[0]).includes("Seul le propriétaire"));
  });

  await cas("\"=move\" hors de tout salon vocal : message d'erreur clair", async () => {
    const msg = fakeMessage({ guildId: "g13", authorId: "owner-13", channel: null });
    await serverAdmin.voiceMove(null, msg, [`<@cible-13>`]);
    assert.ok(JSON.stringify(msg._replies[0]).includes("salon vocal temporaire"));
  });

  await cas("\"=lock\" sur un salon NON temporaire est refusé", async () => {
    const channel = fakeChannel("vc-nontemp-1"); // jamais enregistré
    const msg = fakeMessage({ guildId: "g14", authorId: "owner-14", channel });
    await serverAdmin.voiceLock(null, msg, []);
    assert.ok(JSON.stringify(msg._replies[0]).includes("pas un salon temporaire"));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
