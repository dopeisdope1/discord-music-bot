/**
 * "=mute"/"=unmute"/"=deaf"/"=undeaf"/"=disconnect"/"=move"
 * (utils/serverAdminCommands.js::handleVoiceAliasTextCommand +
 * utils/serverExtra.js) — un simple catalogue de commandes de MODÉRATION
 * VOCALE réelle, chacune agissant sur N'IMPORTE QUEL membre actuellement en
 * vocal, gardée par le VRAI droit `server.voice.manage` — PAS un système de
 * propriété de salon vocal temporaire (aucune notion de "ton salon" ici).
 * "=disconnect"/"=move" délèguent aux commandes déjà existantes et testées
 * `&voicekick`/`&mv` ; "=mute"/"=unmute"/"=deaf"/"=undeaf" sont neuves mais
 * suivent EXACTEMENT le même patron (mêmes helpers, même permission).
 *
 * Lancement : node scripts/test-voice-commands.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "voice-commands-test-"));
process.env.BOT_OWNER_IDS = "";

const { Collection, PermissionsBitField, ChannelType } = require("discord.js");
const { handleVoiceAliasTextCommand } = require("../utils/serverAdminCommands");
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

function fakeChannel(id) {
  return { id, type: ChannelType.GuildVoice, members: new Collection(), manageable: true, toString: () => `<#${id}>` };
}

function fakeMember(id, channel) {
  const membre = {
    id,
    user: { id, tag: `${id}#0001` },
    voice: {
      channel: channel || null,
      channelId: channel?.id || null,
      setMute: async function (v) {
        this._mute = v;
      },
      setDeaf: async function (v) {
        this._deaf = v;
      },
      disconnect: async function () {
        this.channel = null;
        this.channelId = null;
      },
      setChannel: async function (c) {
        this.channel = c;
        this.channelId = c?.id || null;
      },
    },
  };
  if (channel) channel.members.set(id, membre);
  return membre;
}

function fakeVoice(channel) {
  return {
    channel: channel || null,
    channelId: channel?.id || null,
    setChannel: async function (c) {
      this.channel = c;
      this.channelId = c?.id || null;
    },
  };
}

function fakeMessage({
  guildId = "g1",
  authorId = "staff-1",
  content,
  mentionsMember = null,
  mentionsChannel = null,
  guildChannels = [],
  authorChannel = null,
} = {}) {
  const replies = [];
  const membersMap = new Map();
  if (mentionsMember) membersMap.set(mentionsMember.id, mentionsMember);
  const guild = {
    id: guildId,
    channels: { cache: new Collection(guildChannels.map((c) => [c.id, c])) },
    members: { me: { permissions: new PermissionsBitField(PermissionsBitField.All) }, fetch: async (uid) => membersMap.get(uid) || null },
  };
  return {
    content,
    author: { id: authorId, bot: false, tag: `${authorId}#0000` },
    guild,
    member: { id: authorId, guild, roles: { cache: new Collection() }, permissions: new PermissionsBitField(), voice: fakeVoice(authorChannel) },
    mentions: {
      users: mentionsMember ? new Collection([[mentionsMember.id, mentionsMember.user]]) : new Collection(),
      channels: mentionsChannel ? new Collection([[mentionsChannel.id, mentionsChannel]]) : new Collection(),
    },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

const texte = (msg) => JSON.stringify(msg._replies[0] || {});

(async () => {
  console.log("Isolation du préfixe \"=\" :");

  await cas("le préfixe \"=\" (owner) est bien distinct de \"&\"", () => {
    const { owner, musicMod } = getPrefixes("g-quelconque");
    assert.strictEqual(owner, "=");
    assert.notStrictEqual(owner, musicMod);
  });

  await cas("mot inconnu sur ce préfixe : silence", async () => {
    const msg = fakeMessage({ guildId: "g0", content: "=nimportequoi" });
    await handleVoiceAliasTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("\"=add\" (autre commande sur ce même préfixe) ne déclenche jamais ce dispatcher vocal", async () => {
    permStore.grantToUser("g0b", "staff-1", "server.voice.manage");
    const msg = fakeMessage({ guildId: "g0b", content: "=add <@cible>" });
    await handleVoiceAliasTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("mauvais préfixe (\"&mute\") ne déclenche jamais ce dispatcher", async () => {
    permStore.grantToUser("g0c", "staff-1", "server.voice.manage");
    const msg = fakeMessage({ guildId: "g0c", content: "&mute <@cible>" });
    await handleVoiceAliasTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("message de bot ignoré", async () => {
    const msg = fakeMessage({ guildId: "g0d", content: "=mute <@cible>" });
    msg.author.bot = true;
    await handleVoiceAliasTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  // parseTarget() (utils/serverExtra.js) n'accepte qu'une VRAIE mention ou un
  // identifiant Discord (regex \d{15,25}) — des snowflakes réalistes, pas
  // des libellés lisibles comme "cible-1".
  const CIBLE_1 = "400000000000000001";
  const CIBLE_2 = "400000000000000002";
  const CIBLE_3 = "400000000000000003";
  const CIBLE_4 = "400000000000000004";
  const CIBLE_5 = "400000000000000005";
  const CIBLE_6 = "400000000000000006";
  const CIBLE_7 = "400000000000000007";
  const CIBLE_8 = "400000000000000008";

  console.log("\n\"=mute\"/\"=unmute\" — mute vocal Discord natif (PAS le mute-rôle punitif de \"&mute\") :");

  await cas("\"=mute @membre\" mute réellement N'IMPORTE QUI en vocal (pas besoin d'un salon \"à soi\")", async () => {
    permStore.grantToUser("g1", "staff-1", "server.voice.manage");
    const channel = fakeChannel("chan-1");
    const cible = fakeMember(CIBLE_1, channel);
    const msg = fakeMessage({ guildId: "g1", authorId: "staff-1", content: `=mute <@${CIBLE_1}>`, mentionsMember: cible });
    await handleVoiceAliasTextCommand(null, msg);
    assert.strictEqual(cible.voice._mute, true);
  });

  await cas("\"=unmute @membre\" démute réellement", async () => {
    permStore.grantToUser("g2", "staff-1", "server.voice.manage");
    const channel = fakeChannel("chan-2");
    const cible = fakeMember(CIBLE_2, channel);
    const msg = fakeMessage({ guildId: "g2", authorId: "staff-1", content: `=unmute <@${CIBLE_2}>`, mentionsMember: cible });
    await handleVoiceAliasTextCommand(null, msg);
    assert.strictEqual(cible.voice._mute, false);
  });

  await cas("sans server.voice.manage, \"=mute\" reste silencieux", async () => {
    const channel = fakeChannel("chan-3");
    const cible = fakeMember(CIBLE_3, channel);
    const msg = fakeMessage({ guildId: "g3", authorId: "sans-perm", content: `=mute <@${CIBLE_3}>`, mentionsMember: cible });
    await handleVoiceAliasTextCommand(null, msg);
    assert.strictEqual(cible.voice._mute, undefined);
  });

  await cas("cible pas en vocal : message informatif, pas de plantage", async () => {
    permStore.grantToUser("g4", "staff-1", "server.voice.manage");
    const cible = fakeMember(CIBLE_4, null);
    const msg = fakeMessage({ guildId: "g4", authorId: "staff-1", content: `=mute <@${CIBLE_4}>`, mentionsMember: cible });
    await handleVoiceAliasTextCommand(null, msg);
    assert.ok(texte(msg).includes("n'est pas en vocal"), texte(msg));
  });

  console.log("\n\"=deaf\"/\"=undeaf\" — sourdine vocale native :");

  await cas("\"=deaf @membre\" applique réellement la sourdine", async () => {
    permStore.grantToUser("g5", "staff-1", "server.voice.manage");
    const channel = fakeChannel("chan-5");
    const cible = fakeMember(CIBLE_5, channel);
    const msg = fakeMessage({ guildId: "g5", authorId: "staff-1", content: `=deaf <@${CIBLE_5}>`, mentionsMember: cible });
    await handleVoiceAliasTextCommand(null, msg);
    assert.strictEqual(cible.voice._deaf, true);
  });

  await cas("\"=undeaf @membre\" lève réellement la sourdine", async () => {
    permStore.grantToUser("g6", "staff-1", "server.voice.manage");
    const channel = fakeChannel("chan-6");
    const cible = fakeMember(CIBLE_6, channel);
    const msg = fakeMessage({ guildId: "g6", authorId: "staff-1", content: `=undeaf <@${CIBLE_6}>`, mentionsMember: cible });
    await handleVoiceAliasTextCommand(null, msg);
    assert.strictEqual(cible.voice._deaf, false);
  });

  console.log("\n\"=disconnect\" — délègue à \"&voicekick\" (déjà écrit/testé) :");

  await cas("\"=disconnect @membre\" expulse réellement du vocal", async () => {
    permStore.grantToUser("g7", "staff-1", "server.voice.manage");
    const channel = fakeChannel("chan-7");
    const cible = fakeMember(CIBLE_7, channel);
    const msg = fakeMessage({ guildId: "g7", authorId: "staff-1", content: `=disconnect <@${CIBLE_7}>`, mentionsMember: cible });
    await handleVoiceAliasTextCommand(null, msg);
    assert.strictEqual(cible.voice.channel, null);
  });

  console.log("\n\"=move\" — délègue à \"&mv\" (déjà écrit/testé) :");

  await cas("\"=move @membre #salon\" déplace réellement vers le salon indiqué", async () => {
    permStore.grantToUser("g8", "staff-1", "server.voice.manage");
    const depart = fakeChannel("chan-depart-8");
    const arrivee = fakeChannel("chan-arrivee-8");
    const cible = fakeMember(CIBLE_8, depart);
    const msg = fakeMessage({
      guildId: "g8",
      authorId: "staff-1",
      content: `=move <@${CIBLE_8}> #arrivee`,
      mentionsMember: cible,
      mentionsChannel: arrivee,
    });
    await handleVoiceAliasTextCommand(null, msg);
    assert.strictEqual(cible.voice.channel, arrivee);
  });

  await cas("\"=mv\" est un alias de \"=move\" (déplace aussi vers le salon indiqué)", async () => {
    permStore.grantToUser("g8b", "staff-1", "server.voice.manage");
    const depart = fakeChannel("chan-depart-8b");
    const arrivee = fakeChannel("chan-arrivee-8b");
    const cible = fakeMember("400000000000000082", depart);
    const msg = fakeMessage({
      guildId: "g8b",
      authorId: "staff-1",
      content: `=mv <@400000000000000082> #arrivee`,
      mentionsMember: cible,
      mentionsChannel: arrivee,
    });
    await handleVoiceAliasTextCommand(null, msg);
    assert.strictEqual(cible.voice.channel, arrivee);
  });

  console.log("\n\"=find\"/\"=wakeup\"/\"=join\"/\"=bringall\" — nouvelles commandes vocales :");

  const CIBLE_F = "400000000000000091";
  const CIBLE_W = "400000000000000092";
  const CIBLE_J = "400000000000000093";

  await cas("\"=find @membre\" indique le salon vocal du membre", async () => {
    permStore.grantToUser("gf", "staff-1", "server.voice.manage");
    const salon = fakeChannel("chan-find");
    const cible = fakeMember(CIBLE_F, salon);
    const msg = fakeMessage({ guildId: "gf", authorId: "staff-1", content: `=find <@${CIBLE_F}>`, mentionsMember: cible });
    await handleVoiceAliasTextCommand(null, msg);
    assert.ok(texte(msg).includes("chan-find"), texte(msg));
  });

  await cas("\"=find\" sur un membre hors vocal le dit clairement", async () => {
    permStore.grantToUser("gf2", "staff-1", "server.voice.manage");
    const cible = fakeMember("400000000000000094", null);
    const msg = fakeMessage({ guildId: "gf2", authorId: "staff-1", content: `=find <@400000000000000094>`, mentionsMember: cible });
    await handleVoiceAliasTextCommand(null, msg);
    assert.ok(texte(msg).includes("aucun salon vocal"), texte(msg));
  });

  await cas("\"=wakeup @membre\" fait rebondir le membre puis le ramène dans son salon d'origine", async () => {
    permStore.grantToUser("gw", "staff-1", "server.voice.manage");
    const salon = fakeChannel("chan-wakeup");
    const autre = fakeChannel("chan-autre-wakeup");
    const cible = fakeMember(CIBLE_W, salon);
    const msg = fakeMessage({
      guildId: "gw",
      authorId: "staff-1",
      content: `=wakeup <@${CIBLE_W}>`,
      mentionsMember: cible,
      guildChannels: [salon, autre],
    });
    await handleVoiceAliasTextCommand(null, msg);
    assert.strictEqual(cible.voice.channelId, salon.id); // revenu dans son salon
    assert.ok(texte(msg).includes("réveillé"), texte(msg));
  });

  await cas("\"=wakeup\" échoue proprement s'il n'y a aucun autre salon vocal", async () => {
    permStore.grantToUser("gw2", "staff-1", "server.voice.manage");
    const salon = fakeChannel("chan-wakeup-seul");
    const cible = fakeMember("400000000000000095", salon);
    const msg = fakeMessage({
      guildId: "gw2",
      authorId: "staff-1",
      content: `=wakeup <@400000000000000095>`,
      mentionsMember: cible,
      guildChannels: [salon],
    });
    await handleVoiceAliasTextCommand(null, msg);
    assert.ok(texte(msg).includes("au moins un autre salon"), texte(msg));
  });

  await cas("\"=join @membre\" déplace L'AUTEUR vers le salon du membre", async () => {
    permStore.grantToUser("gj", "staff-1", "server.voice.manage");
    const salonCible = fakeChannel("chan-cible-join");
    const salonAuteur = fakeChannel("chan-auteur-join");
    const cible = fakeMember(CIBLE_J, salonCible);
    const msg = fakeMessage({
      guildId: "gj",
      authorId: "staff-1",
      content: `=join <@${CIBLE_J}>`,
      mentionsMember: cible,
      authorChannel: salonAuteur,
    });
    await handleVoiceAliasTextCommand(null, msg);
    assert.strictEqual(msg.member.voice.channelId, salonCible.id); // l'auteur a bougé
  });

  await cas("\"=join\" refuse si l'auteur n'est pas déjà en vocal", async () => {
    permStore.grantToUser("gj2", "staff-1", "server.voice.manage");
    const salonCible = fakeChannel("chan-cible-join2");
    const cible = fakeMember("400000000000000096", salonCible);
    const msg = fakeMessage({
      guildId: "gj2",
      authorId: "staff-1",
      content: `=join <@400000000000000096>`,
      mentionsMember: cible,
      authorChannel: null,
    });
    await handleVoiceAliasTextCommand(null, msg);
    assert.ok(texte(msg).includes("déjà être connecté"), texte(msg));
  });

  await cas("\"=bringall\" rassemble tout le monde dans le salon de l'auteur", async () => {
    permStore.grantToUser("gb", "staff-1", "server.voice.moveall");
    const salonAuteur = fakeChannel("chan-auteur-bringall");
    const autre = fakeChannel("chan-autre-bringall");
    const membre1 = fakeMember("400000000000000097", autre);
    const membre2 = fakeMember("400000000000000098", autre);
    const msg = fakeMessage({
      guildId: "gb",
      authorId: "staff-1",
      content: "=bringall",
      authorChannel: salonAuteur,
      guildChannels: [salonAuteur, autre],
    });
    await handleVoiceAliasTextCommand(null, msg);
    assert.strictEqual(membre1.voice.channelId, salonAuteur.id);
    assert.strictEqual(membre2.voice.channelId, salonAuteur.id);
  });

  await cas("sans permission, \"=find\" reste silencieux", async () => {
    const salon = fakeChannel("chan-find-noperm");
    const cible = fakeMember("400000000000000099", salon);
    const msg = fakeMessage({ guildId: "gnp", authorId: "sans-perm", content: `=find <@400000000000000099>`, mentionsMember: cible });
    await handleVoiceAliasTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
