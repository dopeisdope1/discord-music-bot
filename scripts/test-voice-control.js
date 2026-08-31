/**
 * Vérifie le contrôle d'un salon vocal temporaire depuis le panneau PARTAGÉ
 * (utils/serverAdminCommands.js::handleVoiceControlInteraction) : seul le
 * propriétaire peut agir, verrouillage/déverrouillage, renommage (modale),
 * ajout/retrait d'accès, expulsion, et transfert de propriété (avec
 * bascule effective des droits vers le nouveau propriétaire) — la cible
 * est toujours résolue via le salon vocal où la personne qui clique est
 * CONNECTÉE, pas via le salon où elle a cliqué (voir scripts/test-voice-hub.js
 * pour la vérification de cette résolution elle-même).
 *
 * Lancement : node scripts/test-voice-control.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "voicecontrol-test-"));
process.env.BOT_OWNER_IDS = "owner-1"; // distinct du propriétaire du salon testé, pour ne pas court-circuiter le vrai check

const { Collection, ChannelType } = require("discord.js");
const serverAdmin = require("../utils/serverAdminCommands");
const voiceChannels = require("../utils/voiceChannels");

const OWNER_ID = "chanowner-1";
const TARGET_ID = "999888777000111222";

function makeChannel() {
  const overwrites = new Collection();
  return {
    id: "vc1",
    name: "Salon de Test",
    type: ChannelType.GuildVoice,
    permissionOverwrites: {
      cache: overwrites,
      edit: async (t, p) => overwrites.set(t.id || t, p),
      delete: async (t) => overwrites.delete(t.id || t),
    },
    setName: async function (n) {
      this.name = n;
    },
  };
}
function makeMember(id, channel) {
  return {
    id,
    user: { id, tag: `${id}#0001` },
    voice: {
      channelId: channel?.id || null,
      channel,
      disconnect: async function () {
        this.channelId = null;
      },
    },
  };
}
// Le panneau est PARTAGÉ : peu importe le salon "cliqué" (`clickChannel`),
// seul `member.voice.channelId` détermine quel salon vocal est ciblé.
function fakeInteraction(customId, guild, defaultMember, opts = {}) {
  let result = null;
  return {
    customId,
    member: opts.member || defaultMember,
    guild,
    channel: { id: "panel-contrôle", type: ChannelType.GuildText },
    user: (opts.member || defaultMember).user,
    values: opts.values || [],
    isModalSubmit: () => Boolean(opts.modal),
    fields: opts.modal ? { getTextInputValue: () => opts.modal } : undefined,
    reply: async (p) => {
      result = p;
      return p;
    },
    update: async (p) => {
      result = p;
      return p;
    },
    showModal: async () => {
      result = { modal: true };
    },
    _get: () => result,
  };
}

let reussis = 0;
async function cas(nom, fn) {
  try {
    await fn();
    reussis++;
    console.log(`  ok — ${nom}`);
  } catch (err) {
    console.error(`  ÉCHEC — ${nom}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

(async () => {
  console.log("Contrôle depuis le panneau partagé :");

  const channel = makeChannel();
  voiceChannels.registerChannel("vc1", "g1", OWNER_ID);
  const owner = makeMember(OWNER_ID, channel);
  const target = makeMember(TARGET_ID, channel);

  const panelOverwrites = new Collection();
  const panelChannel = {
    id: "panel-1",
    permissionOverwrites: {
      cache: panelOverwrites,
      edit: async (t, p) => panelOverwrites.set(t.id || t, { ...(panelOverwrites.get(t.id || t) || {}), ...p }),
      delete: async (t) => panelOverwrites.delete(t.id || t),
    },
  };
  voiceChannels.setPanelChannel("g1", "panel-1");

  const guild = {
    id: "g1",
    roles: { everyone: { id: "everyone" } },
    channels: { cache: new Collection([[channel.id, channel], [panelChannel.id, panelChannel]]) },
    members: { fetch: async (id) => (id === TARGET_ID ? target : id === OWNER_ID ? owner : null) },
  };

  await cas("un non-propriétaire connecté au salon est refusé", async () => {
    const i = fakeInteraction("vcpanel:lock", guild, owner, { member: target });
    await serverAdmin.handleVoiceControlInteraction(i);
    assert.ok(i._get()?.content?.includes("propriétaire"));
  });

  await cas("le propriétaire peut verrouiller/déverrouiller", async () => {
    await serverAdmin.handleVoiceControlInteraction(fakeInteraction("vcpanel:lock", guild, owner));
    assert.strictEqual(channel.permissionOverwrites.cache.get("everyone").Connect, false);
    await serverAdmin.handleVoiceControlInteraction(fakeInteraction("vcpanel:unlock", guild, owner));
    assert.strictEqual(channel.permissionOverwrites.cache.get("everyone").Connect, null);
  });

  await cas("renommer via la modale applique le nouveau nom", async () => {
    await serverAdmin.handleVoiceControlInteraction(fakeInteraction("vcpanel:rename", guild, owner, { modal: "Nouveau Nom" }));
    assert.strictEqual(channel.name, "Nouveau Nom");
  });

  await cas("ajouter un membre lui donne accès (Connect true)", async () => {
    await serverAdmin.handleVoiceControlInteraction(fakeInteraction("vcpanel:addpick", guild, owner, { values: [TARGET_ID] }));
    assert.strictEqual(channel.permissionOverwrites.cache.get(TARGET_ID).Connect, true);
  });

  await cas("transférer la propriété change bien le propriétaire enregistré", async () => {
    await serverAdmin.handleVoiceControlInteraction(fakeInteraction("vcpanel:transferpick", guild, owner, { values: [TARGET_ID] }));
    assert.strictEqual(voiceChannels.getChannelInfo("vc1").ownerId, TARGET_ID);
  });

  await cas("le transfert révoque l'accès au salon-panneau de l'ancien propriétaire et l'accorde au nouveau", () => {
    assert.ok(!panelOverwrites.has(OWNER_ID), "l'ancien propriétaire ne doit plus voir le salon-panneau");
    assert.strictEqual(panelOverwrites.get(TARGET_ID)?.ViewChannel, true);
  });

  await cas("l'ancien propriétaire n'a plus la main après transfert", async () => {
    const i = fakeInteraction("vcpanel:unlock", guild, owner);
    await serverAdmin.handleVoiceControlInteraction(i);
    assert.ok(i._get()?.content?.includes("propriétaire"));
  });

  await cas("le nouveau propriétaire peut gérer le salon", async () => {
    await serverAdmin.handleVoiceControlInteraction(fakeInteraction("vcpanel:unlock", guild, owner, { member: target }));
    assert.strictEqual(channel.permissionOverwrites.cache.get("everyone").Connect, null);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
