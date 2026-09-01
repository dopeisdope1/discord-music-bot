/**
 * Vérifie le message DM envoyé AVANT le ban de masse (utils/banAll.js,
 * utils/banAllDmStore.js) : "&banall message <texte>" configure ce que
 * chaque membre reçoit en DM juste avant d'être banni (typiquement un lien
 * vers un nouveau serveur) — aucun DM tant que rien n'est configuré, un DM
 * fermé n'empêche jamais le ban de continuer.
 *
 * Lancement : node scripts/test-banall-dm.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "banalldm-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionFlagsBits } = require("discord.js");
const banAllDmStore = require("../utils/banAllDmStore");
const { handleBanAll, handleBanAllInteraction, ID } = require("../utils/banAll");

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

function fakeMember(id, { position = 1 } = {}) {
  const sent = [];
  return {
    id,
    user: { id, tag: `${id}#0001`, bot: false },
    roles: { highest: { position } },
    send: async (text) => {
      sent.push(text);
      return {};
    },
    ban: async () => {},
    _sent: sent,
  };
}

function fakeGuild(memberList) {
  const cache = new Collection(memberList.map((m) => [m.id, m]));
  return {
    id: "g1",
    name: "Serveur de test",
    ownerId: "owner-1",
    members: {
      me: {
        id: "bot-1",
        roles: { highest: { position: 99 } },
        // canBulkBan() vérifie [BanMembers, ManageGuild] (un tableau) ; le
        // reste du code ne vérifie qu'un seul flag à la fois — distinguer
        // les deux force le repli un-par-un pour exercer le VRAI appel
        // member.ban() (pas l'API de masse guild.bans.bulkCreate).
        permissions: { has: (flags) => !Array.isArray(flags) },
      },
      cache,
      fetch: async () => cache,
    },
    bans: {},
  };
}

function fakeMessage(guild, author = "owner-1") {
  const replies = [];
  return {
    author: { id: author, tag: `${author}#0001` },
    member: { id: author, guild, roles: { cache: new Collection() } },
    guild,
    channel: {
      send: async (p) => {
        replies.push(p);
        return {};
      },
    },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

const bodyOf = (payload) => payload.components[0].toJSON().components[2]?.content || "";

(async () => {
  console.log("&banall message <texte> — configurer le DM :");

  await cas("sans argument, indique qu'aucun message n'est configuré", async () => {
    const guild = fakeGuild([]);
    const msg = fakeMessage(guild);
    await handleBanAll(null, msg, ["message"]);
    assert.ok(bodyOf(msg._replies[0]).includes("Aucun message configuré"), bodyOf(msg._replies[0]));
  });

  await cas("avec un texte, l'enregistre et le confirme", async () => {
    const guild = fakeGuild([]);
    const msg = fakeMessage(guild);
    await handleBanAll(null, msg, ["message", "Rejoins", "le", "nouveau", "serveur", ":", "https://discord.gg/abc"]);
    assert.strictEqual(banAllDmStore.getDmMessage("g1"), "Rejoins le nouveau serveur : https://discord.gg/abc");
    assert.ok(bodyOf(msg._replies[0]).includes("discord.gg/abc"));
  });

  await cas("relire sans argument affiche bien le message enregistré", async () => {
    const guild = fakeGuild([]);
    const msg = fakeMessage(guild);
    await handleBanAll(null, msg, ["message"]);
    assert.ok(bodyOf(msg._replies[0]).includes("discord.gg/abc"));
  });

  console.log("\nConfirmation du ban de masse — mention du DM :");

  await cas("la carte de confirmation annonce le DM quand un message est configuré", async () => {
    banAllDmStore.setDmMessage("g2", "Va sur https://discord.gg/nouveau");
    const target = fakeMember("u1");
    const guild = fakeGuild([target]);
    guild.id = "g2";
    guild.ownerId = "owner-1";
    const msg = fakeMessage(guild);
    await handleBanAll(null, msg, []);
    const confirmBody = bodyOf(msg._replies[1]);
    assert.ok(confirmBody.includes("recevra ce message en DM"), confirmBody);
  });

  await cas("sans message configuré, la carte le dit clairement", async () => {
    const target = fakeMember("u2");
    const guild = fakeGuild([target]);
    guild.id = "g3";
    guild.ownerId = "owner-1";
    const msg = fakeMessage(guild);
    await handleBanAll(null, msg, []);
    const confirmBody = bodyOf(msg._replies[1]);
    assert.ok(confirmBody.includes("Aucun message configuré"), confirmBody);
  });

  console.log("\nEnvoi réel des DM avant le ban :");

  await cas("chaque cible reçoit le message en DM AVANT d'être bannie", async () => {
    banAllDmStore.setDmMessage("g4", "Nouveau serveur : https://discord.gg/xyz");
    const u1 = fakeMember("u1");
    const u2 = fakeMember("u2");
    const guild = fakeGuild([u1, u2]);
    guild.id = "g4";
    guild.ownerId = "owner-1";
    const msg = fakeMessage(guild);
    await handleBanAll(null, msg, []);

    const confirmCard = msg._replies[1];
    const goButton = confirmCard.components[0]
      .toJSON()
      .components.find((c) => c.type === 1)
      .components.find((b) => b.label.startsWith("Bannir"));

    let updated = null;
    const interaction = {
      customId: goButton.custom_id,
      user: { id: "owner-1", tag: "owner#0001" },
      member: { id: "owner-1", guild, roles: { cache: new Collection() } },
      guild,
      client: {},
      channelId: "chan-1",
      update: async (p) => {
        updated = p;
      },
      message: { edit: async () => {} },
    };
    await handleBanAllInteraction(interaction);

    assert.deepStrictEqual(u1._sent, ["Nouveau serveur : https://discord.gg/xyz"]);
    assert.deepStrictEqual(u2._sent, ["Nouveau serveur : https://discord.gg/xyz"]);
  });

  await cas("un DM fermé (send échoue) n'empêche pas le ban de continuer", async () => {
    banAllDmStore.setDmMessage("g5", "Rejoins-nous ailleurs");
    const u1 = fakeMember("u1");
    u1.send = async () => {
      throw new Error("Cannot send messages to this user");
    };
    let banned = false;
    u1.ban = async () => {
      banned = true;
    };
    const guild = fakeGuild([u1]);
    guild.id = "g5";
    guild.ownerId = "owner-1";
    const msg = fakeMessage(guild);
    await handleBanAll(null, msg, []);

    const confirmCard = msg._replies[1];
    const goButton = confirmCard.components[0]
      .toJSON()
      .components.find((c) => c.type === 1)
      .components.find((b) => b.label.startsWith("Bannir"));

    const interaction = {
      customId: goButton.custom_id,
      user: { id: "owner-1", tag: "owner#0001" },
      member: { id: "owner-1", guild, roles: { cache: new Collection() } },
      guild,
      client: {},
      channelId: "chan-1",
      update: async () => {},
      message: { edit: async () => {} },
    };
    await handleBanAllInteraction(interaction);
    assert.ok(banned, "le ban doit avoir lieu même si le DM a échoué");
  });

  await cas("sans message configuré, aucun DM n'est envoyé — juste le ban", async () => {
    const u1 = fakeMember("u1");
    const guild = fakeGuild([u1]);
    guild.id = "g6";
    guild.ownerId = "owner-1";
    const msg = fakeMessage(guild);
    await handleBanAll(null, msg, []);

    const confirmCard = msg._replies[1];
    const goButton = confirmCard.components[0]
      .toJSON()
      .components.find((c) => c.type === 1)
      .components.find((b) => b.label.startsWith("Bannir"));

    const interaction = {
      customId: goButton.custom_id,
      user: { id: "owner-1", tag: "owner#0001" },
      member: { id: "owner-1", guild, roles: { cache: new Collection() } },
      guild,
      client: {},
      channelId: "chan-1",
      update: async () => {},
      message: { edit: async () => {} },
    };
    await handleBanAllInteraction(interaction);
    assert.deepStrictEqual(u1._sent, []);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
