/**
 * "=owner <@membre>" (utils/serverAdminCommands.js::handleOwnerVoiceTextCommand)
 * — transfère la propriété de TON salon vocal temporaire à ce membre
 * (demande explicite : "mettre owner voc"). Délègue entièrement à
 * `vc(client, message, ["transfer", ...args])`, exactement "&voc transfer
 * @membre" (déjà écrit, déjà testé dans scripts/test-voice-control.js pour
 * le panneau) — ce fichier vérifie seulement le NOUVEAU point d'entrée texte
 * sur le préfixe séparé "=", pas le mécanisme de transfert lui-même.
 *
 * Lancement : node scripts/test-owner-voice.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "owner-voice-test-"));
process.env.BOT_OWNER_IDS = "";

const { Collection, ChannelType } = require("discord.js");
const serverAdmin = require("../utils/serverAdminCommands");
const voiceChannels = require("../utils/voiceChannels");
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
    voice: { channelId: channel?.id || null, channel, disconnect: async () => {} },
  };
}

function fakeMessage({ guildId = "g1", authorId = "owner-1", content, channel = null, mentionedMember = null } = {}) {
  const replies = [];
  return {
    content,
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
  console.log("\"=owner\" — transfert de propriété d'un salon vocal temporaire :");

  await cas("hors de tout salon vocal, message d'erreur clair", async () => {
    const msg = fakeMessage({ guildId: "g1", authorId: "owner-1", content: `=owner <@cible-1>` });
    await serverAdmin.handleOwnerVoiceTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 1);
    assert.ok(JSON.stringify(msg._replies[0]).includes("salon vocal temporaire"));
  });

  await cas("transfère vraiment la propriété à un membre présent dans le salon", async () => {
    const channel = fakeChannel("vc-owner-1");
    voiceChannels.registerChannel(channel.id, "g2", "owner-2");
    const cible = fakeMember("cible-2", channel);
    const msg = fakeMessage({ guildId: "g2", authorId: "owner-2", content: `=owner <@cible-2>`, channel, mentionedMember: cible });
    await serverAdmin.handleOwnerVoiceTextCommand(null, msg);
    assert.strictEqual(voiceChannels.getChannelInfo(channel.id).ownerId, "cible-2");
    assert.ok(JSON.stringify(msg._replies[0]).includes("propriétaire"));
  });

  await cas("seul le PROPRIÉTAIRE ACTUEL peut transférer — un invité ne peut pas", async () => {
    const channel = fakeChannel("vc-owner-3");
    voiceChannels.registerChannel(channel.id, "g3", "vrai-owner-3");
    const cible = fakeMember("cible-3", channel);
    const msg = fakeMessage({ guildId: "g3", authorId: "invite-3", content: `=owner <@cible-3>`, channel, mentionedMember: cible });
    await serverAdmin.handleOwnerVoiceTextCommand(null, msg);
    assert.strictEqual(voiceChannels.getChannelInfo(channel.id).ownerId, "vrai-owner-3");
    assert.ok(JSON.stringify(msg._replies[0]).includes("Seul le propriétaire"));
  });

  await cas("la cible doit être DANS le salon pour en devenir propriétaire", async () => {
    const channel = fakeChannel("vc-owner-4");
    voiceChannels.registerChannel(channel.id, "g4", "owner-4");
    const cibleAilleurs = fakeMember("cible-4", fakeChannel("autre-salon")); // pas dans le même salon
    const msg = fakeMessage({ guildId: "g4", authorId: "owner-4", content: `=owner <@cible-4>`, channel, mentionedMember: cibleAilleurs });
    await serverAdmin.handleOwnerVoiceTextCommand(null, msg);
    assert.strictEqual(voiceChannels.getChannelInfo(channel.id).ownerId, "owner-4");
  });

  await cas("sans mention, rappelle la syntaxe sans planter", async () => {
    const channel = fakeChannel("vc-owner-5");
    voiceChannels.registerChannel(channel.id, "g5", "owner-5");
    const msg = fakeMessage({ guildId: "g5", authorId: "owner-5", content: "=owner", channel });
    await serverAdmin.handleOwnerVoiceTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 1);
    assert.ok(JSON.stringify(msg._replies[0]).includes("voc transfer"));
  });

  await cas("un salon vocal NON temporaire (pas géré par le bot) est refusé", async () => {
    const channel = fakeChannel("vc-owner-6"); // jamais enregistré via registerChannel
    const cible = fakeMember("cible-6", channel);
    const msg = fakeMessage({ guildId: "g6", authorId: "owner-6", content: `=owner <@cible-6>`, channel, mentionedMember: cible });
    await serverAdmin.handleOwnerVoiceTextCommand(null, msg);
    assert.ok(JSON.stringify(msg._replies[0]).includes("pas un salon temporaire"));
  });

  console.log("\nIsolation des préfixes :");

  await cas("un mot inconnu sur ce préfixe reste silencieux", async () => {
    const msg = fakeMessage({ guildId: "g7", authorId: "owner-7", content: "=nimportequoi" });
    await serverAdmin.handleOwnerVoiceTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("\"&owner\" (mauvais préfixe) ne déclenche jamais cette commande", async () => {
    const channel = fakeChannel("vc-owner-8");
    voiceChannels.registerChannel(channel.id, "g8", "owner-8");
    const msg = fakeMessage({ guildId: "g8", authorId: "owner-8", content: "&owner <@cible-8>", channel });
    await serverAdmin.handleOwnerVoiceTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("\"=add\" (autre commande sur ce même préfixe) ne déclenche jamais \"=owner\"", async () => {
    const channel = fakeChannel("vc-owner-9");
    voiceChannels.registerChannel(channel.id, "g9", "owner-9");
    const msg = fakeMessage({ guildId: "g9", authorId: "owner-9", content: "=add <@cible-9>", channel });
    await serverAdmin.handleOwnerVoiceTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("un message de bot est ignoré", async () => {
    const channel = fakeChannel("vc-owner-10");
    voiceChannels.registerChannel(channel.id, "g10", "owner-10");
    const msg = fakeMessage({ guildId: "g10", authorId: "owner-10", content: "=owner <@cible-10>", channel });
    msg.author.bot = true;
    await serverAdmin.handleOwnerVoiceTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
