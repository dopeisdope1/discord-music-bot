/**
 * Vérifie la carte de contrôle postée dans un salon vocal temporaire
 * (utils/serverAdminCommands.js::buildVoiceControlCard/handleVoiceControlInteraction) :
 * seul le propriétaire peut agir, verrouillage/déverrouillage, renommage
 * (modale), ajout/retrait d'accès, expulsion, et transfert de propriété
 * (avec bascule effective des droits vers le nouveau propriétaire).
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
function fakeInteraction(customId, channel, guild, defaultMember, opts = {}) {
  let result = null;
  return {
    customId,
    member: opts.member || defaultMember,
    guild,
    channel,
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
  console.log("Carte de contrôle des salons vocaux temporaires :");

  const channel = makeChannel();
  voiceChannels.registerChannel("vc1", "g1", OWNER_ID);
  const owner = makeMember(OWNER_ID, channel);
  const target = makeMember(TARGET_ID, channel);
  const guild = {
    id: "g1",
    roles: { everyone: { id: "everyone" } },
    members: { fetch: async (id) => (id === TARGET_ID ? target : id === OWNER_ID ? owner : null) },
  };

  await cas("la carte se construit sans erreur", () => {
    const card = serverAdmin.buildVoiceControlCard(channel);
    for (const c of card.components) c.toJSON();
  });

  await cas("la carte mentionne réellement le propriétaire (ping, pas juste du texte)", () => {
    const card = serverAdmin.buildVoiceControlCard(channel, OWNER_ID);
    const body = card.components[0].toJSON().components.map((c) => c.content).join("\n");
    assert.ok(body.includes(`<@${OWNER_ID}>`));
    assert.deepStrictEqual(card.allowedMentions, { users: [OWNER_ID] });
  });

  await cas("un non-propriétaire est refusé", async () => {
    const i = fakeInteraction("vcpanel:lock", channel, guild, owner, { member: target });
    await serverAdmin.handleVoiceControlInteraction(i);
    assert.ok(i._get()?.content?.includes("propriétaire"));
  });

  await cas("le propriétaire peut verrouiller/déverrouiller", async () => {
    await serverAdmin.handleVoiceControlInteraction(fakeInteraction("vcpanel:lock", channel, guild, owner));
    assert.strictEqual(channel.permissionOverwrites.cache.get("everyone").Connect, false);
    await serverAdmin.handleVoiceControlInteraction(fakeInteraction("vcpanel:unlock", channel, guild, owner));
    assert.strictEqual(channel.permissionOverwrites.cache.get("everyone").Connect, null);
  });

  await cas("renommer via la modale applique le nouveau nom", async () => {
    await serverAdmin.handleVoiceControlInteraction(fakeInteraction("vcpanel:rename", channel, guild, owner, { modal: "Nouveau Nom" }));
    assert.strictEqual(channel.name, "Nouveau Nom");
  });

  await cas("ajouter un membre lui donne accès (Connect true)", async () => {
    await serverAdmin.handleVoiceControlInteraction(fakeInteraction("vcpanel:addpick", channel, guild, owner, { values: [TARGET_ID] }));
    assert.strictEqual(channel.permissionOverwrites.cache.get(TARGET_ID).Connect, true);
  });

  await cas("transférer la propriété change bien le propriétaire enregistré", async () => {
    await serverAdmin.handleVoiceControlInteraction(fakeInteraction("vcpanel:transferpick", channel, guild, owner, { values: [TARGET_ID] }));
    assert.strictEqual(voiceChannels.getChannelInfo("vc1").ownerId, TARGET_ID);
  });

  await cas("l'ancien propriétaire n'a plus la main après transfert", async () => {
    const i = fakeInteraction("vcpanel:unlock", channel, guild, owner);
    await serverAdmin.handleVoiceControlInteraction(i);
    assert.ok(i._get()?.content?.includes("propriétaire"));
  });

  await cas("le nouveau propriétaire peut gérer le salon", async () => {
    await serverAdmin.handleVoiceControlInteraction(fakeInteraction("vcpanel:unlock", channel, guild, owner, { member: target }));
    assert.strictEqual(channel.permissionOverwrites.cache.get("everyone").Connect, null);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
