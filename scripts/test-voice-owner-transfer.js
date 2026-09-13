/**
 * "=owner <@membre>" (utils/serverAdminCommands.js::voiceOwnerTransfer) —
 * transfère la propriété de TON salon vocal temporaire, même mécanique que
 * "&voc transfer @membre" (déjà écrite/testée dans scripts/test-voice-
 * control.js), mais avec la présentation "Owner" (buildVoiceOwnerCard) au
 * lieu de l'embed `success` classique. "Statut" affiche une liste RÉELLE de
 * contrôles (jamais une permission inventée : devenir propriétaire est un
 * accès tout-ou-rien, pas un octroi du catalogue de permissions).
 *
 * Lancement : node scripts/test-voice-owner-transfer.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "voice-owner-transfer-test-"));
process.env.BOT_OWNER_IDS = "";

const { Collection, ChannelType } = require("discord.js");
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
  console.log("\"=owner\" — transfert avec présentation \"Owner\" :");

  await cas("hors de tout salon vocal, message d'erreur clair", async () => {
    const msg = fakeMessage({ guildId: "g1", authorId: "owner-1", content: "=owner <@cible-1>" });
    await serverAdmin.voiceOwnerTransfer(null, msg, [`<@cible-1>`]);
    assert.strictEqual(msg._replies.length, 1);
    assert.ok(JSON.stringify(msg._replies[0]).includes("salon vocal temporaire"));
  });

  await cas("transfère vraiment la propriété, et poste la carte \"Owner\"", async () => {
    const channel = fakeChannel("vc-owner-2");
    voiceChannels.registerChannel(channel.id, "g2", "owner-2");
    const cible = fakeMember("cible-2", channel);
    const msg = fakeMessage({ guildId: "g2", authorId: "owner-2", channel, mentionedMember: cible });
    await serverAdmin.voiceOwnerTransfer(null, msg, [`<@cible-2>`]);
    assert.strictEqual(voiceChannels.getChannelInfo(channel.id).ownerId, "cible-2");
    const texte = JSON.stringify(msg._replies[0].components);
    assert.ok(texte.includes("## Owner"), texte);
    assert.ok(texte.includes("Propriétaire"), texte);
    assert.ok(texte.includes("owner-2#0000"), texte); // "Transféré par"
  });

  await cas("la liste de contrôles listée est RÉELLE (pas de permission inventée)", async () => {
    const channel = fakeChannel("vc-owner-3");
    voiceChannels.registerChannel(channel.id, "g3", "owner-3");
    const cible = fakeMember("cible-3", channel);
    const msg = fakeMessage({ guildId: "g3", authorId: "owner-3", channel, mentionedMember: cible });
    await serverAdmin.voiceOwnerTransfer(null, msg, [`<@cible-3>`]);
    const texte = JSON.stringify(msg._replies[0].components);
    for (const attendu of ["=lock", "=mute", "=deaf", "=move", "=wl", "&voc rename", "&voc add"]) {
      assert.ok(texte.includes(attendu), `"${attendu}" manquant : ${texte}`);
    }
  });

  await cas("seul le PROPRIÉTAIRE ACTUEL peut transférer — un invité ne peut pas", async () => {
    const channel = fakeChannel("vc-owner-4");
    voiceChannels.registerChannel(channel.id, "g4", "vrai-owner-4");
    const cible = fakeMember("cible-4", channel);
    const msg = fakeMessage({ guildId: "g4", authorId: "invite-4", channel, mentionedMember: cible });
    await serverAdmin.voiceOwnerTransfer(null, msg, [`<@cible-4>`]);
    assert.strictEqual(voiceChannels.getChannelInfo(channel.id).ownerId, "vrai-owner-4");
    assert.ok(JSON.stringify(msg._replies[0]).includes("Seul le propriétaire"));
  });

  await cas("la cible doit être DANS le salon pour en devenir propriétaire", async () => {
    const channel = fakeChannel("vc-owner-5");
    voiceChannels.registerChannel(channel.id, "g5", "owner-5");
    const cibleAilleurs = fakeMember("cible-5", fakeChannel("autre-salon"));
    const msg = fakeMessage({ guildId: "g5", authorId: "owner-5", channel, mentionedMember: cibleAilleurs });
    await serverAdmin.voiceOwnerTransfer(null, msg, [`<@cible-5>`]);
    assert.strictEqual(voiceChannels.getChannelInfo(channel.id).ownerId, "owner-5");
  });

  await cas("sans mention, rappelle la syntaxe sans planter", async () => {
    const channel = fakeChannel("vc-owner-6");
    voiceChannels.registerChannel(channel.id, "g6", "owner-6");
    const msg = fakeMessage({ guildId: "g6", authorId: "owner-6", channel });
    await serverAdmin.voiceOwnerTransfer(null, msg, []);
    assert.strictEqual(msg._replies.length, 1);
    assert.ok(JSON.stringify(msg._replies[0]).includes("owner @membre"));
  });

  await cas("un salon vocal NON temporaire (pas géré par le bot) est refusé", async () => {
    const channel = fakeChannel("vc-owner-7");
    const cible = fakeMember("cible-7", channel);
    const msg = fakeMessage({ guildId: "g7", authorId: "owner-7", channel, mentionedMember: cible });
    await serverAdmin.voiceOwnerTransfer(null, msg, [`<@cible-7>`]);
    assert.ok(JSON.stringify(msg._replies[0]).includes("pas un salon temporaire"));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
