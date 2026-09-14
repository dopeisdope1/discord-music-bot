/**
 * "!!" devient l'écosystème SÉCURITÉ complet (architecture 3 préfixes,
 * utils/securityAliases.js) : wl/unwl/whitelist/unwhitelist/antinuke/
 * antiraid/antilink/antispam/security/lockdown. Chaque mot délègue
 * directement à la fonction "&" déjà écrite et testée (guardHandlers,
 * automodHandlers, serverAdminCommands, moderationHandlers) — aucune
 * nouvelle logique de sécurité, seulement un second point d'entrée, même
 * store, même permission. "&"-équivalents restent strictement inchangés.
 *
 * Lancement : node scripts/test-security-aliases.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "security-aliases-test-"));
process.env.BOT_OWNER_IDS = "";

const { Collection, PermissionsBitField, ChannelType } = require("discord.js");
const { handleSecurityAliasTextCommand, ALIASES } = require("../utils/securityAliases");
const permStore = require("../utils/permissions/store");
const guardWhitelist = require("../utils/guard/whitelist");
const guardConfig = require("../utils/guard/config");
const automod = require("../utils/automod/antiSpam");
const antiLink = require("../utils/automod/antiLink");
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

function fakeChannel(id = "chan-1") {
  const overwrites = new Collection();
  return {
    id,
    type: ChannelType.GuildText,
    permissionOverwrites: {
      cache: overwrites,
      edit: async (t, p) => overwrites.set(t.id || t, p),
    },
  };
}

/** Assez riche pour computeSecurityScan (rôles/salons/membres) ET &lockdown (members.me, channels.cache manageable). */
function fakeGuild(id, { channel } = {}) {
  const canal = channel || fakeChannel("chan-1");
  canal.manageable = true;
  return {
    id,
    roles: {
      everyone: { id, permissions: new PermissionsBitField([]) },
      cache: new Collection(),
    },
    channels: { cache: new Collection([[canal.id, canal]]) },
    members: { cache: new Collection(), me: { permissions: new PermissionsBitField(PermissionsBitField.All) } },
  };
}

function fakeMessage({
  guildId = "g1",
  authorId = "staff-1",
  content,
  users = [],
  channel = fakeChannel(),
} = {}) {
  const replies = [];
  const guild = fakeGuild(guildId, { channel });
  return {
    content,
    author: { id: authorId, bot: false, tag: `${authorId}#0000` },
    guild,
    member: { id: authorId, guild, roles: { cache: new Collection() }, permissions: new PermissionsBitField() },
    channel,
    mentions: {
      users: new Collection(users.map((u) => [u.id, u])),
      roles: new Collection(),
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
  console.log("Isolation du préfixe \"!!\" :");

  await cas("le préfixe \"!!\" (protection) est bien distinct de \"&\"", () => {
    const { protection, musicMod } = getPrefixes("g-quelconque");
    assert.strictEqual(protection, "!!");
    assert.notStrictEqual(protection, musicMod);
  });

  await cas("mot inconnu sur ce préfixe : silence", async () => {
    const msg = fakeMessage({ guildId: "g0", content: "!!nimportequoi" });
    await handleSecurityAliasTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("mauvais préfixe (\"&wl\") ne déclenche jamais cet alias", async () => {
    permStore.grantToUser("g0b", "staff-1", "protection.guard.manage");
    const msg = fakeMessage({ guildId: "g0b", content: "&wl <@cible>" });
    await handleSecurityAliasTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  await cas("message de bot ignoré", async () => {
    const msg = fakeMessage({ guildId: "g0c", content: "!!wl <@cible>" });
    msg.author.bot = true;
    await handleSecurityAliasTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0);
  });

  console.log("\n\"!!wl\"/\"!!unwl\" — whitelist ANTI-NUKE (utils/guard/whitelist.js) :");

  await cas("\"!!wl @membre\" ajoute réellement à la whitelist anti-nuke", async () => {
    permStore.grantToUser("g1", "staff-1", "protection.guard.manage");
    const cible = { id: "cible-1", tag: "cible1#0000" };
    const msg = fakeMessage({ guildId: "g1", content: "!!wl <@cible-1>", users: [cible] });
    await handleSecurityAliasTextCommand(null, msg);
    assert.ok(guardWhitelist.getWhitelist("g1").users.includes("cible-1"));
  });

  await cas("\"!!unwl @membre\" retire réellement de la whitelist anti-nuke", async () => {
    permStore.grantToUser("g2", "staff-1", "protection.guard.manage");
    guardWhitelist.add("g2", "users", "cible-2");
    const cible = { id: "cible-2", tag: "cible2#0000" };
    const msg = fakeMessage({ guildId: "g2", content: "!!unwl <@cible-2>", users: [cible] });
    await handleSecurityAliasTextCommand(null, msg);
    assert.ok(!guardWhitelist.getWhitelist("g2").users.includes("cible-2"));
  });

  await cas("sans protection.guard.manage, \"!!wl\" reste silencieux (même garde que \"&wl\")", async () => {
    const cible = { id: "cible-3", tag: "cible3#0000" };
    const msg = fakeMessage({ guildId: "g3", authorId: "sans-perm", content: "!!wl <@cible-3>", users: [cible] });
    await handleSecurityAliasTextCommand(null, msg);
    assert.ok(!guardWhitelist.getWhitelist("g3").users.includes("cible-3"));
  });

  console.log("\n\"!!whitelist\"/\"!!unwhitelist\" — whitelist ANTI-SPAM (utils/automod/antiSpam.js, DISTINCTE de la précédente) :");

  await cas("\"!!whitelist\" ouvre la MÊME carte que \"&whitelist\"", async () => {
    permStore.grantToUser("g4", "staff-1", "protection.whitelist");
    const msg = fakeMessage({ guildId: "g4", content: "!!whitelist" });
    await handleSecurityAliasTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 1);
    assert.ok(texte(msg).includes("Liste WL"), texte(msg));
  });

  await cas("\"!!unwhitelist @membre\" retire réellement de la whitelist anti-spam", async () => {
    permStore.grantToUser("g5", "staff-1", "protection.whitelist");
    automod.addToWhitelist("g5", "users", "cible-5");
    const cible = { id: "cible-5", tag: "cible5#0000" };
    const msg = fakeMessage({ guildId: "g5", content: "!!unwhitelist <@cible-5>", users: [cible] });
    await handleSecurityAliasTextCommand(null, msg);
    assert.ok(!automod.getWhitelist("g5").users.includes("cible-5"));
  });

  await cas("\"!!unwhitelist\" sans argument rappelle sa syntaxe sans planter", async () => {
    permStore.grantToUser("g5b", "staff-1", "protection.whitelist");
    const msg = fakeMessage({ guildId: "g5b", content: "!!unwhitelist" });
    await handleSecurityAliasTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 1);
  });

  await cas("les deux whitelists restent DISTINCTES (ajouter à l'une n'affecte pas l'autre)", async () => {
    permStore.grantToUser("g6", "staff-1", "protection.guard.manage");
    permStore.grantToUser("g6", "staff-1", "protection.whitelist");
    const cible = { id: "cible-6", tag: "cible6#0000" };
    await handleSecurityAliasTextCommand(null, fakeMessage({ guildId: "g6", content: "!!wl <@cible-6>", users: [cible] }));
    assert.ok(guardWhitelist.getWhitelist("g6").users.includes("cible-6"));
    assert.ok(!automod.getWhitelist("g6").users.includes("cible-6"));
  });

  console.log("\n\"!!antinuke\"/\"!!antiraid\" — même moteur, synonymes (utils/guard/config.js) :");

  await cas("\"!!antinuke on\" active réellement le guard config", async () => {
    permStore.grantToUser("g7", "staff-1", "protection.guard.manage");
    const msg = fakeMessage({ guildId: "g7", content: "!!antinuke on" });
    await handleSecurityAliasTextCommand(null, msg);
    assert.strictEqual(guardConfig.getConfig("g7").enabled, true);
  });

  await cas("\"!!antiraid on\" active EXACTEMENT le même config que \"!!antinuke\" (synonyme, pas un 2e moteur)", async () => {
    permStore.grantToUser("g8", "staff-1", "protection.guard.manage");
    assert.strictEqual(ALIASES.antiraid, ALIASES.antinuke);
    const msg = fakeMessage({ guildId: "g8", content: "!!antiraid on" });
    await handleSecurityAliasTextCommand(null, msg);
    assert.strictEqual(guardConfig.getConfig("g8").enabled, true);
  });

  console.log("\n\"!!antilink\"/\"!!antispam\" — même config que \"&antilink\"/\"&antispam\" :");

  await cas("\"!!antilink on\" active réellement l'anti-lien", async () => {
    permStore.grantToUser("g9", "staff-1", "protection.automod");
    const msg = fakeMessage({ guildId: "g9", content: "!!antilink on" });
    await handleSecurityAliasTextCommand(null, msg);
    assert.strictEqual(antiLink.getConfig("g9").enabled, true);
  });

  await cas("\"!!antispam on\" active réellement l'anti-spam", async () => {
    permStore.grantToUser("g10", "staff-1", "protection.automod");
    const msg = fakeMessage({ guildId: "g10", content: "!!antispam on" });
    await handleSecurityAliasTextCommand(null, msg);
    assert.strictEqual(require("../utils/automod/antiSpam").getConfig("g10").enabled, true);
  });

  console.log("\n\"!!security\" — alias de \"!!secur\" (même panneau) :");

  await cas("sans permission, \"!!security\" refuse", async () => {
    const msg = fakeMessage({ guildId: "g11", authorId: "sans-perm", content: "!!security" });
    await handleSecurityAliasTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 1);
    assert.ok(texte(msg).includes("permission"), texte(msg));
  });

  await cas("avec la permission, poste le panneau de sécurité (composants V2)", async () => {
    permStore.grantToUser("g12", "staff-1", "protection.automod");
    const envoyes = [];
    const msg = fakeMessage({ guildId: "g12", content: "!!security" });
    msg.channel.send = async (p) => {
      envoyes.push(p);
      return {};
    };
    await handleSecurityAliasTextCommand(null, msg);
    assert.strictEqual(envoyes.length, 1);
    assert.ok(envoyes[0].components, JSON.stringify(envoyes[0]));
  });

  console.log("\n\"!!lockdown\" — même verrouillage de salon que \"&lockdown\" :");

  await cas("\"!!lockdown\" verrouille réellement le salon courant (SendMessages: false pour @everyone)", async () => {
    permStore.grantToUser("g13", "staff-1", "channels.lockdown");
    const channel = fakeChannel("chan-lockdown");
    const msg = fakeMessage({ guildId: "g13", content: "!!lockdown", channel });
    await handleSecurityAliasTextCommand(null, msg);
    const overwrite = channel.permissionOverwrites.cache.get("g13");
    assert.strictEqual(overwrite?.SendMessages, false);
  });

  await cas("sans channels.lockdown, \"!!lockdown\" ne touche à rien", async () => {
    const channel = fakeChannel("chan-lockdown-2");
    const msg = fakeMessage({ guildId: "g14", authorId: "sans-perm", content: "!!lockdown", channel });
    await handleSecurityAliasTextCommand(null, msg);
    assert.strictEqual(channel.permissionOverwrites.cache.size, 0);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
