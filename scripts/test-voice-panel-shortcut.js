/**
 * "=panel" (utils/serverAdminCommands.js::voicePanelShortcut) — raccourci
 * direct vers la section "Vocaux" déjà existante de "&panel"
 * (utils/configPanel.js), même garde `server.voice.manage`, aucune UI
 * dupliquée. Couvre aussi "=vc" (utils/serverAdminCommands.js::
 * voiceQuickPanel), raccourci texte vers le même centre de contrôle que le
 * salon-panneau partagé.
 *
 * Lancement : node scripts/test-voice-panel-shortcut.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "voice-panel-shortcut-test-"));
process.env.BOT_OWNER_IDS = "";

const { Collection, ChannelType } = require("discord.js");
const serverAdmin = require("../utils/serverAdminCommands");
const permStore = require("../utils/permissions/store");
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

function fakeGuild(id) {
  return {
    id,
    roles: { everyone: { id }, cache: new Collection() },
    channels: { cache: new Collection() },
    members: { cache: new Collection() },
  };
}

function fakeMessage({ guildId = "g1", authorId = "staff-1", channel = null } = {}) {
  const replies = [];
  const guild = fakeGuild(guildId);
  return {
    guild,
    member: { id: authorId, guild, roles: { cache: new Collection() }, voice: { channelId: channel?.id || null, channel } },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

(async () => {
  console.log("\"=panel\" — raccourci vers &panel > Vocaux :");

  await cas("sans server.voice.manage, silence", async () => {
    const msg = fakeMessage({ guildId: "g1", authorId: "u1" });
    await serverAdmin.voicePanelShortcut(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("avec la permission, ouvre directement la section Vocaux (pas l'accueil)", async () => {
    permStore.grantToUser("g2", "staff-2", "server.voice.manage");
    const msg = fakeMessage({ guildId: "g2", authorId: "staff-2" });
    await serverAdmin.voicePanelShortcut(null, msg);
    assert.strictEqual(msg._replies.length, 1);
    const texte = JSON.stringify(msg._replies[0]);
    assert.ok(texte.includes("Vocaux"), texte);
  });

  await cas("sans la permission, ne redirige jamais silencieusement vers l'accueil (refus net)", async () => {
    const msg = fakeMessage({ guildId: "g3", authorId: "sans-perm" });
    await serverAdmin.voicePanelShortcut(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  console.log("\n\"=vc\" — centre de contrôle rapide (même carte que le salon-panneau partagé) :");

  function fakeChannel(id = "vc1") {
    return { id, type: ChannelType.GuildVoice, permissionOverwrites: { edit: async () => {}, delete: async () => {} } };
  }

  await cas("hors de tout salon vocal temporaire, message d'erreur clair", async () => {
    const msg = fakeMessage({ guildId: "g4", authorId: "owner-4" });
    await serverAdmin.voiceQuickPanel(null, msg);
    assert.ok(JSON.stringify(msg._replies[0]).includes("salon vocal temporaire"));
  });

  await cas("propriétaire d'un salon temporaire : reçoit le centre de contrôle", async () => {
    const channel = fakeChannel("vc-quick-5");
    voiceChannels.registerChannel(channel.id, "g5", "owner-5");
    const msg = fakeMessage({ guildId: "g5", authorId: "owner-5", channel });
    await serverAdmin.voiceQuickPanel(null, msg);
    assert.strictEqual(msg._replies.length, 1);
    assert.ok(JSON.stringify(msg._replies[0]).includes("Centre de contrôle vocal"));
  });

  await cas("un invité (pas le propriétaire) est refusé", async () => {
    const channel = fakeChannel("vc-quick-6");
    voiceChannels.registerChannel(channel.id, "g6", "vrai-owner-6");
    const msg = fakeMessage({ guildId: "g6", authorId: "invite-6", channel });
    await serverAdmin.voiceQuickPanel(null, msg);
    assert.ok(JSON.stringify(msg._replies[0]).includes("Seul le propriétaire"));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
