/**
 * Vérifie &backup (utils/serverBackup.js) : capture de la structure d'un
 * serveur (catégories/salons/ordre/limites vocales, PAS les permissions ni
 * les messages), sauvegarde/liste/suppression, et restauration dans un
 * autre serveur — le cas d'usage réel qui a motivé cette commande : un bot
 * banni de son serveur d'origine, dont la structure a été saisie à la main
 * depuis des captures d'écran (préréglage "yunara").
 *
 * Lancement : node scripts/test-server-backup.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "srvbackup-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, ChannelType } = require("discord.js");
const { backup, captureGuildStructure, applyStructure, resolveBackup, PRESET_BACKUPS } = require("../utils/serverBackup");
const backupStore = require("../utils/serverBackupStore");
const voiceChannels = require("../utils/voiceChannels");
const serverAdmin = require("../utils/serverAdminCommands");

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

let nextChannelId = 1;
/** Fausse guild avec un guild.channels.create() qui crée VRAIMENT une entrée dans le cache, comme discord.js. */
function fakeGuild(id) {
  const guild = {
    id,
    name: `Serveur ${id}`,
    channels: {
      cache: new Collection(),
      create: async ({ name, type, parent, userLimit }) => {
        const channel = { id: `c${nextChannelId++}`, name, type, parentId: parent || null, userLimit: userLimit || 0, rawPosition: nextChannelId };
        guild.channels.cache.set(channel.id, channel);
        return channel;
      },
    },
  };
  return guild;
}

function fakeMessage(guild, { author = { id: "owner-1", tag: "owner#0001" } } = {}) {
  const replies = [];
  return {
    author,
    member: { id: author.id, guild: { id: guild.id }, permissions: { has: () => true } },
    guild,
    channel: { id: "chan-1" },
    reply: async (p) => {
      replies.push(p);
      return { id: "msg-1" };
    },
    _replies: replies,
  };
}

const embedText = (reply) => reply?.embeds?.[0]?.data?.description || "";
const cardText = (reply) => reply?.components?.[0]?.toJSON().components.filter((c) => c.type === 10).map((c) => c.content).join("\n") || "";

function extractConfirmToken(reply) {
  const row = reply.components[0].toJSON().components.find((c) => c.type === 1);
  const goButton = row.components.find((c) => c.custom_id.includes(":go:"));
  return goButton.custom_id.split(":").pop();
}

(async () => {
  console.log("captureGuildStructure — lit vraiment la structure d'un serveur :");

  await cas("catégories/salons/limites de places/générateur vocal capturés dans l'ordre", () => {
    const guild = fakeGuild("g-source");
    const cat = { id: "cat-1", name: "Vocaux", type: ChannelType.GuildCategory, parentId: null, rawPosition: 0 };
    const voc1 = { id: "v1", name: "vocal 1", type: ChannelType.GuildVoice, parentId: "cat-1", userLimit: 5, rawPosition: 1 };
    const voc2 = { id: "v2", name: "hub", type: ChannelType.GuildVoice, parentId: "cat-1", userLimit: 0, rawPosition: 2 };
    const top = { id: "t1", name: "rules", type: ChannelType.GuildText, parentId: null, rawPosition: 0 };
    for (const c of [cat, voc1, voc2, top]) guild.channels.cache.set(c.id, c);
    voiceChannels.setHub("g-source", "v2");

    const structure = captureGuildStructure(guild);
    assert.strictEqual(structure.categories.length, 1);
    assert.strictEqual(structure.categories[0].name, "Vocaux");
    assert.strictEqual(structure.categories[0].channels.length, 2);
    assert.strictEqual(structure.categories[0].channels[0].userLimit, 5);
    assert.strictEqual(structure.categories[0].channels[1].isVoiceHub, true);
    assert.strictEqual(structure.uncategorized.length, 1);
    assert.strictEqual(structure.uncategorized[0].name, "rules");
  });

  console.log("\napplyStructure — recrée VRAIMENT dans un autre serveur :");

  await cas("crée les catégories, les salons, préserve type/parent/limite, rebranche le générateur vocal", async () => {
    const source = fakeGuild("g-src2");
    const cat = { id: "cat-1", name: "Vocaux", type: ChannelType.GuildCategory, parentId: null, rawPosition: 0 };
    const voc1 = { id: "v1", name: "vocal 1", type: ChannelType.GuildVoice, parentId: "cat-1", userLimit: 3, rawPosition: 1 };
    const hub = { id: "v2", name: "hub", type: ChannelType.GuildVoice, parentId: "cat-1", userLimit: 0, rawPosition: 2 };
    for (const c of [cat, voc1, hub]) source.channels.cache.set(c.id, c);
    voiceChannels.setHub("g-src2", "v2");
    const structure = captureGuildStructure(source);

    const target = fakeGuild("g-target");
    const { categoriesCreated, channelsCreated, wiredVoiceHub } = await applyStructure(target, structure);
    assert.strictEqual(categoriesCreated, 1);
    assert.strictEqual(channelsCreated, 2);
    assert.strictEqual(wiredVoiceHub, true);

    const created = [...target.channels.cache.values()];
    const createdCategory = created.find((c) => c.type === ChannelType.GuildCategory);
    const createdVoice = created.find((c) => c.name === "vocal 1");
    assert.strictEqual(createdVoice.parentId, createdCategory.id);
    assert.strictEqual(createdVoice.userLimit, 3);

    const createdHub = created.find((c) => c.name === "hub");
    assert.strictEqual(voiceChannels.getHub("g-target"), createdHub.id, "le générateur vocal doit être rebranché sur le NOUVEAU serveur");
  });

  console.log("\n&backup <nom>/list/delete — store :");

  await cas("réservé au rang sys — sans, aucune réponse", async () => {
    const guild = fakeGuild("g-perm");
    const message = fakeMessage(guild, { author: { id: "quelqu-un-d-autre", tag: "x#0000" } });
    await backup(null, message, ["test"]);
    assert.strictEqual(message._replies.length, 0);
  });

  await cas("backup <nom> sauvegarde la structure actuelle et le confirme", async () => {
    const guild = fakeGuild("g-save");
    guild.channels.cache.set("t1", { id: "t1", name: "chat", type: ChannelType.GuildText, parentId: null, rawPosition: 0 });
    const message = fakeMessage(guild);
    await backup(null, message, ["masave"]);
    assert.ok(embedText(message._replies[0]).includes("enregistrée"), embedText(message._replies[0]));
    assert.ok(backupStore.getBackup("masave"));
  });

  await cas("backup <nom> refuse d'écraser un nom de préréglage (piège : &backup yunara au lieu de &backup load yunara)", async () => {
    const guild = fakeGuild("g-shadow");
    guild.channels.cache.set("t1", { id: "t1", name: "chat", type: ChannelType.GuildText, parentId: null, rawPosition: 0 });
    const message = fakeMessage(guild);
    await backup(null, message, ["yunara"]);
    assert.ok(embedText(message._replies[0]).includes("préréglage"), embedText(message._replies[0]));
    assert.strictEqual(backupStore.getBackup("yunara"), null, "le préréglage ne doit jamais être masqué par le store");
    assert.strictEqual(resolveBackup("yunara").categories.length, PRESET_BACKUPS.yunara.categories.length, "le vrai préréglage doit rester intact");
  });

  await cas("backup list montre les préréglages ET les sauvegardes enregistrées", async () => {
    const guild = fakeGuild("g-list");
    const message = fakeMessage(guild);
    await backup(null, message, ["list"]);
    const texte = embedText(message._replies[0]);
    assert.ok(texte.includes("masave"), texte);
    assert.ok(texte.includes("yunara") && texte.includes("préréglage"), texte);
  });

  await cas("backup delete retire une sauvegarde enregistrée", async () => {
    const guild = fakeGuild("g-del");
    const message = fakeMessage(guild);
    await backup(null, message, ["delete", "masave"]);
    assert.ok(embedText(message._replies[0]).includes("supprimée"));
    assert.strictEqual(backupStore.getBackup("masave"), null);
  });

  await cas("backup delete refuse de supprimer un préréglage intégré", async () => {
    const guild = fakeGuild("g-del2");
    const message = fakeMessage(guild);
    await backup(null, message, ["delete", "yunara"]);
    assert.ok(embedText(message._replies[0]).includes("préréglage"));
    assert.ok(resolveBackup("yunara"), "le préréglage doit toujours exister");
  });

  console.log("\n&backup load — confirmation obligatoire avant de créer quoi que ce soit :");

  await cas("load sans confirmation ne crée AUCUN salon", async () => {
    const guild = fakeGuild("g-noconfirm");
    const message = fakeMessage(guild);
    await backup(null, message, ["load", "yunara"]);
    assert.strictEqual(guild.channels.cache.size, 0);
    assert.ok(cardText(message._replies[0]).includes("Confirmer"), cardText(message._replies[0]));
  });

  await cas("confirmer restaure vraiment le préréglage \"yunara\" (rules inclus, .gg/yunara exclu)", async () => {
    const guild = fakeGuild("g-yunara");
    const message = fakeMessage(guild);
    await backup(null, message, ["load", "yunara"]);
    const token = extractConfirmToken(message._replies[0]);

    const interaction = {
      customId: `srv:confirm:go:${token}`,
      user: message.author,
      member: message.member,
      guild,
      update: async (p) => { message._replies.push(p); },
    };
    await serverAdmin.handleConfirmInteraction(interaction);

    const created = [...guild.channels.cache.values()];
    assert.ok(created.some((c) => c.name === "rules" && c.type === ChannelType.GuildText), "rules doit être recréé");
    assert.ok(!created.some((c) => c.name.includes(".gg/yunara")), ".gg/yunara ne doit PAS être recréé");
    const hub = created.find((c) => c.name === "➕ Nouveau salon vocal");
    assert.ok(hub, "le salon générateur doit exister");
    assert.strictEqual(voiceChannels.getHub("g-yunara"), hub.id, "le générateur doit être rebranché sur le nouveau serveur");
    const prv6 = created.find((c) => c.name === "prv 6");
    assert.strictEqual(prv6.userLimit, 4);
  });

  await cas("annuler ne crée aucun salon", async () => {
    const guild = fakeGuild("g-cancel");
    const message = fakeMessage(guild);
    await backup(null, message, ["load", "yunara"]);
    const row = message._replies[0].components[0].toJSON().components.find((c) => c.type === 1);
    const noButton = row.components.find((c) => c.custom_id.includes(":no:"));
    const token = noButton.custom_id.split(":").pop();
    const interaction = {
      customId: `srv:confirm:no:${token}`,
      user: message.author,
      member: message.member,
      guild,
      update: async (p) => { message._replies.push(p); },
    };
    await serverAdmin.handleConfirmInteraction(interaction);
    assert.strictEqual(guild.channels.cache.size, 0);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
