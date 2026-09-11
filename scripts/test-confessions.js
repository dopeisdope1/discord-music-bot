/**
 * Vérifie "!!confess" (utils/confessions.js) : confessions anonymes postées
 * dans un salon configurable — demande explicite inspirée d'une capture d'un
 * salon #confess. Même préfixe que "!!panel" (utils/personalProtection.js),
 * mot différent après ("confess") — les deux ne doivent jamais se marcher
 * dessus.
 *
 * L'ANONYMAT est le point central : le message d'origine doit TOUJOURS être
 * supprimé, quoi qu'il arrive ensuite (succès, erreur, limite atteinte), et
 * aucune réponse ne doit jamais partir dans le salon public — tout part en
 * MP à l'auteur.
 *
 * Lancement : node scripts/test-confessions.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "confessions-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection } = require("discord.js");
const { handleConfessTextCommand } = require("../utils/confessions");
const confessStore = require("../utils/confessStore");
const permStore = require("../utils/permissions/store");

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

function fakeChannel(id, { peutEnvoyer = true } = {}) {
  const envois = [];
  return {
    id,
    isTextBased: () => true,
    send: async (payload) => {
      if (!peutEnvoyer) throw new Error("Missing Access");
      envois.push(payload);
      return { id: `msg-${envois.length}` };
    },
    _envois: envois,
  };
}

function fakeMessage({ authorId = "u1", guildId = "g1", content, channel, member } = {}) {
  const dms = [];
  const replies = [];
  let supprime = false;
  return {
    content,
    author: {
      id: authorId,
      bot: false,
      tag: `${authorId}#0001`,
      send: async (c) => {
        dms.push(c);
        return {};
      },
    },
    guild: { id: guildId, channels: { cache: new Collection() } },
    channel: channel || { id: "chan-defaut" },
    member: member || { id: authorId, guild: { id: guildId }, roles: { cache: new Collection() } },
    delete: async () => {
      supprime = true;
      return {};
    },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    get _supprime() {
      return supprime;
    },
    _dms: dms,
    _replies: replies,
  };
}

(async () => {
  console.log("Préfixe et mot-clé :");

  await cas('"!!confess" avec un mot inconnu après le préfixe reste silencieux', async () => {
    const msg = fakeMessage({ content: "!!nimportequoi" });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(msg._supprime, false);
    assert.strictEqual(msg._dms.length, 0);
  });

  await cas('le préfixe "&" (modération) n\'est pas concerné', async () => {
    const msg = fakeMessage({ content: "&confess coucou" });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(msg._supprime, false);
  });

  console.log("\n!!confess setup :");

  await cas("sans channels.manage, la configuration est refusée", async () => {
    const msg = fakeMessage({ authorId: "u-sans", guildId: "g-setup-1", content: "!!confess setup" });
    await handleConfessTextCommand(null, msg);
    assert.ok(msg._replies[0]?.includes?.("pas la permission") || msg._replies[0]?.content?.includes?.("pas la permission"));
    assert.strictEqual(confessStore.getConfig("g-setup-1").channelId, null);
  });

  await cas("avec channels.manage, configure le salon COURANT", async () => {
    permStore.grantToUser("g-setup-2", "u-admin", "channels.manage");
    const channel = { id: "salon-confess" };
    const msg = fakeMessage({ authorId: "u-admin", guildId: "g-setup-2", content: "!!confess setup", channel });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(confessStore.getConfig("g-setup-2").channelId, "salon-confess");
    assert.ok(msg._replies.length, "doit confirmer la configuration");
  });

  console.log("\n!!confess <message> — anonymat :");

  await cas("le message d'origine est TOUJOURS supprimé, même sans salon configuré", async () => {
    const msg = fakeMessage({ authorId: "u2", guildId: "g-vide", content: "!!confess un secret" });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(msg._supprime, true);
    assert.strictEqual(msg._replies.length, 0, "aucune réponse ne doit partir dans le salon public");
  });

  await cas("sans salon configuré, un MP explique comment configurer", async () => {
    const msg = fakeMessage({ authorId: "u3", guildId: "g-vide-2", content: "!!confess un secret" });
    await handleConfessTextCommand(null, msg);
    assert.ok(msg._dms[0].includes("setup"), msg._dms[0]);
  });

  await cas("un salon configuré reçoit un embed coloré, numéroté, avec le texte", async () => {
    const channel = fakeChannel("salon-ok");
    permStore.grantToUser("g-ok", "u-admin", "channels.manage");
    const setup = fakeMessage({ authorId: "u-admin", guildId: "g-ok", content: "!!confess setup", channel });
    await handleConfessTextCommand(null, setup);
    // On enregistre manuellement le salon comme "existant" pour la suite, le
    // store ne connaît que son ID.
    const guildChannels = new Collection([[channel.id, channel]]);

    const msg = fakeMessage({ authorId: "u4", guildId: "g-ok", content: "!!confess Baisons eren les amis" });
    msg.guild.channels.cache = guildChannels;
    await handleConfessTextCommand(null, msg);

    assert.strictEqual(msg._supprime, true);
    assert.strictEqual(channel._envois.length, 1);
    const embed = channel._envois[0].embeds[0].toJSON ? channel._envois[0].embeds[0].toJSON() : channel._envois[0].embeds[0];
    assert.ok(embed.title.includes("Confession anonyme #1"), JSON.stringify(embed));
    assert.strictEqual(embed.description, "Baisons eren les amis");
    assert.ok(msg._dms[0].includes("envoyée anonymement"), msg._dms[0]);
  });

  await cas("le numéro de confession s'incrémente à chaque envoi", async () => {
    const channel = fakeChannel("salon-num");
    confessStore.setChannel("g-num", channel.id);
    const guildChannels = new Collection([[channel.id, channel]]);

    for (let i = 0; i < 3; i++) {
      const msg = fakeMessage({ authorId: `u-num-${i}`, guildId: "g-num", content: `!!confess message ${i}` });
      msg.guild.channels.cache = guildChannels;
      await handleConfessTextCommand(null, msg);
    }
    const numeros = channel._envois.map((e) => {
      const embed = e.embeds[0].toJSON ? e.embeds[0].toJSON() : e.embeds[0];
      return embed.title;
    });
    assert.deepStrictEqual(numeros, ["📩 Confession anonyme #1", "📩 Confession anonyme #2", "📩 Confession anonyme #3"]);
  });

  await cas("un salon supprimé entre-temps (plus dans le cache) prévient par MP, n'essaie pas d'envoyer", async () => {
    confessStore.setChannel("g-salon-mort", "salon-disparu");
    const msg = fakeMessage({ authorId: "u5", guildId: "g-salon-mort", content: "!!confess coucou" });
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(msg._supprime, true);
    assert.ok(msg._dms[0].includes("n'existe plus"), msg._dms[0]);
  });

  console.log("\nValidation :");

  await cas("un message vide (juste la commande) est refusé par MP, pas envoyé", async () => {
    const channel = fakeChannel("salon-x");
    confessStore.setChannel("g-vide-msg", channel.id);
    const msg = fakeMessage({ authorId: "u6", guildId: "g-vide-msg", content: "!!confess" });
    msg.guild.channels.cache = new Collection([[channel.id, channel]]);
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(channel._envois.length, 0);
    assert.ok(msg._dms[0].includes("Écris ton message"), msg._dms[0]);
  });

  await cas("un message trop long (>4000) est refusé par MP, pas envoyé", async () => {
    const channel = fakeChannel("salon-y");
    confessStore.setChannel("g-trop-long", channel.id);
    const msg = fakeMessage({ authorId: "u7", guildId: "g-trop-long", content: `!!confess ${"a".repeat(4001)}` });
    msg.guild.channels.cache = new Collection([[channel.id, channel]]);
    await handleConfessTextCommand(null, msg);
    assert.strictEqual(channel._envois.length, 0);
    assert.ok(msg._dms[0].includes("trop longue"), msg._dms[0]);
  });

  console.log("\nAnti-spam :");

  await cas("une deuxième confession immédiate est refusée (une par personne à la fois)", async () => {
    const channel = fakeChannel("salon-spam");
    confessStore.setChannel("g-spam", channel.id);
    const guildChannels = new Collection([[channel.id, channel]]);

    const msg1 = fakeMessage({ authorId: "u-spam", guildId: "g-spam", content: "!!confess premier" });
    msg1.guild.channels.cache = guildChannels;
    await handleConfessTextCommand(null, msg1);

    const msg2 = fakeMessage({ authorId: "u-spam", guildId: "g-spam", content: "!!confess deuxieme, tout de suite" });
    msg2.guild.channels.cache = guildChannels;
    await handleConfessTextCommand(null, msg2);

    assert.strictEqual(channel._envois.length, 1, "la deuxième ne doit pas être envoyée");
    assert.strictEqual(msg2._supprime, true, "le message doit quand même être supprimé");
    assert.ok(msg2._dms[0].includes("une confession à la fois") || /confession/i.test(msg2._dms[0]), msg2._dms[0]);
  });

  await cas("n'affecte pas une AUTRE personne sur le même serveur", async () => {
    const channel = fakeChannel("salon-spam2");
    confessStore.setChannel("g-spam2", channel.id);
    const guildChannels = new Collection([[channel.id, channel]]);

    const msg1 = fakeMessage({ authorId: "u-spam-a", guildId: "g-spam2", content: "!!confess un" });
    msg1.guild.channels.cache = guildChannels;
    await handleConfessTextCommand(null, msg1);

    const msg2 = fakeMessage({ authorId: "u-spam-b", guildId: "g-spam2", content: "!!confess deux" });
    msg2.guild.channels.cache = guildChannels;
    await handleConfessTextCommand(null, msg2);

    assert.strictEqual(channel._envois.length, 2);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
