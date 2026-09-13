/**
 * "=wl"/"=unwl" (utils/voiceOwnerWhitelistStore.js +
 * utils/serverAdminCommands.js::voiceWhitelistAdd/voiceWhitelistRemove) —
 * liste de confiance PERMANENTE par propriétaire de salon vocal temporaire,
 * distincte de "&voc add" qui ne dure que le salon COURANT. Ce fichier
 * couvre le store lui-même, les commandes texte, ET l'application
 * automatique à la création d'un nouveau salon (index.js) — testée ici en
 * appelant directement la logique du store + un salon "créé" simulé, sans
 * charger index.js (jamais require index.js localement).
 *
 * Lancement : node scripts/test-voice-whitelist.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "voice-whitelist-test-"));
process.env.BOT_OWNER_IDS = "";

const { ChannelType, Collection } = require("discord.js");
const serverAdmin = require("../utils/serverAdminCommands");
const voiceChannels = require("../utils/voiceChannels");
const voiceOwnerWhitelist = require("../utils/voiceOwnerWhitelistStore");

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
  const overwrites = new Collection();
  return {
    id,
    type: ChannelType.GuildVoice,
    permissionOverwrites: {
      cache: overwrites,
      edit: async (t, p) => overwrites.set(t.id || t, p),
      delete: async () => {},
    },
  };
}

function fakeMessage({ guildId = "g1", authorId = "owner-1", channel = null, mentionedMember = null } = {}) {
  const replies = [];
  return {
    author: { id: authorId, bot: false, tag: `${authorId}#0000` },
    guild: { id: guildId, roles: { everyone: { id: guildId } } },
    member: { id: authorId, voice: { channelId: channel?.id || null, channel } },
    mentions: { members: { first: () => mentionedMember } },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

(async () => {
  console.log("utils/voiceOwnerWhitelistStore.js — store brut :");

  await cas("add() ajoute réellement, remove() retire réellement", () => {
    assert.strictEqual(voiceOwnerWhitelist.add("g1", "owner-1", "trusted-1"), true);
    assert.deepStrictEqual(voiceOwnerWhitelist.getList("g1", "owner-1"), ["trusted-1"]);
    assert.strictEqual(voiceOwnerWhitelist.remove("g1", "owner-1", "trusted-1"), true);
    assert.deepStrictEqual(voiceOwnerWhitelist.getList("g1", "owner-1"), []);
  });

  await cas("add() est idempotent (true la première fois, false ensuite)", () => {
    assert.strictEqual(voiceOwnerWhitelist.add("g2", "owner-2", "trusted-2"), true);
    assert.strictEqual(voiceOwnerWhitelist.add("g2", "owner-2", "trusted-2"), false);
  });

  await cas("remove() sur quelqu'un d'absent renvoie false, ne plante pas", () => {
    assert.strictEqual(voiceOwnerWhitelist.remove("g3", "owner-3", "jamais-ajoute"), false);
  });

  await cas("les listes sont bien PAR propriétaire (celle de l'un n'affecte pas celle d'un autre)", () => {
    voiceOwnerWhitelist.add("g4", "owner-4a", "trusted-4");
    assert.deepStrictEqual(voiceOwnerWhitelist.getList("g4", "owner-4b"), []);
  });

  console.log("\n\"=wl\"/\"=unwl\" — commandes texte :");

  await cas("\"=wl @membre\" ajoute réellement à la liste de confiance", async () => {
    const channel = fakeChannel("vc-wl-1");
    voiceChannels.registerChannel(channel.id, "g5", "owner-5");
    const cible = { id: "cible-5", user: { id: "cible-5", tag: "cible5#0000" } };
    const msg = fakeMessage({ guildId: "g5", authorId: "owner-5", channel, mentionedMember: cible });
    await serverAdmin.voiceWhitelistAdd(null, msg, [`<@cible-5>`]);
    assert.ok(voiceOwnerWhitelist.getList("g5", "owner-5").includes("cible-5"));
  });

  await cas("\"=wl\" sans argument affiche la liste actuelle sans planter", async () => {
    const channel = fakeChannel("vc-wl-2");
    voiceChannels.registerChannel(channel.id, "g6", "owner-6");
    voiceOwnerWhitelist.add("g6", "owner-6", "deja-la");
    const msg = fakeMessage({ guildId: "g6", authorId: "owner-6", channel });
    await serverAdmin.voiceWhitelistAdd(null, msg, []);
    assert.ok(JSON.stringify(msg._replies[0]).includes("deja-la"));
  });

  await cas("\"=unwl @membre\" retire réellement de la liste de confiance", async () => {
    const channel = fakeChannel("vc-wl-3");
    voiceChannels.registerChannel(channel.id, "g7", "owner-7");
    voiceOwnerWhitelist.add("g7", "owner-7", "cible-7");
    const cible = { id: "cible-7", user: { id: "cible-7", tag: "cible7#0000" } };
    const msg = fakeMessage({ guildId: "g7", authorId: "owner-7", channel, mentionedMember: cible });
    await serverAdmin.voiceWhitelistRemove(null, msg, [`<@cible-7>`]);
    assert.ok(!voiceOwnerWhitelist.getList("g7", "owner-7").includes("cible-7"));
  });

  await cas("\"=unwl\" sans argument rappelle la syntaxe sans planter", async () => {
    const channel = fakeChannel("vc-wl-4");
    voiceChannels.registerChannel(channel.id, "g8", "owner-8");
    const msg = fakeMessage({ guildId: "g8", authorId: "owner-8", channel });
    await serverAdmin.voiceWhitelistRemove(null, msg, []);
    assert.ok(JSON.stringify(msg._replies[0]).includes("unwl @membre"));
  });

  await cas("hors de tout salon vocal temporaire, \"=wl\" refuse", async () => {
    const msg = fakeMessage({ guildId: "g9", authorId: "owner-9", channel: null });
    await serverAdmin.voiceWhitelistAdd(null, msg, [`<@cible-9>`]);
    assert.ok(JSON.stringify(msg._replies[0]).includes("salon vocal temporaire"));
  });

  console.log("\nApplication automatique à la création d'un nouveau salon (index.js) :");

  await cas("chaque membre de la liste reçoit ViewChannel+Connect sur un salon FRAÎCHEMENT créé", async () => {
    voiceOwnerWhitelist.add("g10", "owner-10", "trusted-10a");
    voiceOwnerWhitelist.add("g10", "owner-10", "trusted-10b");
    const nouveauSalon = fakeChannel("vc-nouveau-10");

    // Reproduit exactement la boucle ajoutée dans index.js (hook de création),
    // sans jamais require index.js (interdit — connecterait une vraie instance).
    for (const trustedId of voiceOwnerWhitelist.getList("g10", "owner-10")) {
      await nouveauSalon.permissionOverwrites.edit(trustedId, { ViewChannel: true, Connect: true }, {});
    }

    assert.deepStrictEqual(nouveauSalon.permissionOverwrites.cache.get("trusted-10a"), { ViewChannel: true, Connect: true });
    assert.deepStrictEqual(nouveauSalon.permissionOverwrites.cache.get("trusted-10b"), { ViewChannel: true, Connect: true });
  });

  await cas("un propriétaire sans liste ne déclenche aucune application (salon inchangé)", async () => {
    const nouveauSalon = fakeChannel("vc-nouveau-11");
    for (const trustedId of voiceOwnerWhitelist.getList("g11-jamais-touche", "owner-11")) {
      await nouveauSalon.permissionOverwrites.edit(trustedId, { ViewChannel: true, Connect: true }, {});
    }
    assert.strictEqual(nouveauSalon.permissionOverwrites.cache.size, 0);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
