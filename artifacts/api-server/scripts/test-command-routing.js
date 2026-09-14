/**
 * Routage 4 préfixes (utils/commandRouting.js + le dispatch de
 * utils/musicCommands.js / utils/securityAliases.js) : chaque mot de commande
 * est servi par UN seul préfixe selon sa catégorie.
 *   & = gestion, - = modération, !! = sécurité, = = vocal.
 * Déplacement DUR : un mot de modération/sécurité ne répond PLUS sur "&".
 *
 * Lancement : node scripts/test-command-routing.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "routing-test-"));
process.env.BOT_OWNER_IDS = "";
fs.writeFileSync(path.join(process.env.DATA_DIR, "prefixes.json"), JSON.stringify({ legacy: { musicMod: "~" } }));

const { Collection, PermissionsBitField } = require("discord.js");
const routing = require("../utils/commandRouting");
const { handleMusicTextCommand, modHandlers } = require("../utils/musicCommands");
const { handleSecurityAliasTextCommand } = require("../utils/securityAliases");
const { handleVoiceHelpTextCommand } = require("../utils/voiceHelpCommand");
const permStore = require("../utils/permissions/store");
const guardConfig = require("../utils/guard/config");
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

function fakeMessage({ guildId = "g1", authorId = "staff-1", content } = {}) {
  const replies = [];
  return {
    content,
    author: { id: authorId, bot: false, tag: `${authorId}#0000` },
    guild: { id: guildId, roles: { everyone: { id: guildId } } },
    member: { id: authorId, guild: { id: guildId }, roles: { cache: new Collection() }, permissions: new PermissionsBitField() },
    channel: { send: async (p) => replies.push(p) },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

(async () => {
  console.log("Les 4 préfixes existent et sont distincts :");

  await cas("main/musicMod/moderation/protection/owner = ? & - !! =", () => {
    const p = getPrefixes("g-x");
    assert.strictEqual(p.musicMod, "&");
    assert.strictEqual(p.moderation, "-");
    assert.strictEqual(p.protection, "!!");
    assert.strictEqual(p.owner, "=");
    const vals = [p.musicMod, p.moderation, p.protection, p.owner];
    assert.strictEqual(new Set(vals).size, 4, "les 4 préfixes doivent être distincts");
  });

  await cas("les anciennes données de préfixe récupèrent les familles ajoutées", () => {
    const p = getPrefixes("legacy");
    assert.strictEqual(p.musicMod, "~", "la valeur persistée doit rester prioritaire");
    assert.strictEqual(p.moderation, "-", "la modération absente doit reprendre son défaut");
    assert.strictEqual(p.protection, "!!", "la sécurité absente doit reprendre son défaut");
    assert.strictEqual(p.owner, "=", "le vocal absent doit reprendre son défaut");
  });

  console.log("\nbucketDe : chaque mot vers sa catégorie :");

  await cas("modération : ban/kick/mute/warn/clear/lockdown → moderation", () => {
    for (const w of ["ban", "kick", "mute", "warn", "clear", "lockdown", "purge", "cmute"]) {
      assert.strictEqual(routing.bucketDe(w), "moderation", `${w} devrait être modération`);
    }
  });

  await cas("owner → vocal/owner, jamais modération", () => {
    assert.strictEqual(routing.bucketDe("owner"), routing.BUCKET_VOCAL);
  });

  await cas("sécurité : antinuke/antibot/antichannel/badwords/wl/antispam → securite", () => {
    for (const w of ["antinuke", "antibot", "antichannel", "badwords", "wl", "unwl", "antispam", "antilink", "creationlimit"]) {
      assert.strictEqual(routing.bucketDe(w), "securite", `${w} devrait être sécurité`);
    }
  });

  await cas("gestion : ticket/poll/giveaway/role/panel/backup/set → gestion", () => {
    for (const w of ["ticket", "poll", "giveaway", "role", "channel", "panel", "backup", "set", "autorole", "verify", "alladmins", "botadmins"]) {
      assert.strictEqual(routing.bucketDe(w), "gestion", `${w} devrait être gestion`);
    }
  });

  await cas('mot inconnu → gestion (reste sur le préfixe partagé "&")', () => {
    assert.strictEqual(routing.bucketDe("nimportequoi"), "gestion");
    assert.strictEqual(routing.bucketDe(""), "gestion");
  });

  await cas("dispatch positif gestion : &help", async () => {
    const msg = fakeMessage({ guildId: "gdispatch", content: "&help" });
    await handleMusicTextCommand(null, msg);
    assert.ok(msg._replies.length, "&help doit être consommé par la famille gestion");
  });

  await cas("dispatch positif modération : -kick", async () => {
    const original = modHandlers.kick;
    let called = false;
    modHandlers.kick = async () => {
      called = true;
    };
    try {
      await handleMusicTextCommand(null, fakeMessage({ guildId: "gdispatch", content: "-kick" }));
    } finally {
      modHandlers.kick = original;
    }
    assert.ok(called, "-kick doit atteindre le dispatcher modération");
  });

  await cas("dispatch positif vocal : =help", async () => {
    const msg = fakeMessage({ guildId: "gdispatch", content: "=help" });
    await handleVoiceHelpTextCommand(null, msg);
    assert.ok(msg._replies.length, "=help doit être consommé par la famille vocal");
  });

  console.log('\nDéplacement dur : sécurité RETIRÉE de "&", servie sur "!!" :');

  await cas('"!!antibot off/on" bascule vraiment le guard', async () => {
    permStore.grantToUser("gsec1", "staff-1", "protection.guard.manage");
    await handleSecurityAliasTextCommand(null, fakeMessage({ guildId: "gsec1", content: "!!antinuke on" }));
    await handleSecurityAliasTextCommand(null, fakeMessage({ guildId: "gsec1", content: "!!antibot off" }));
    assert.ok(!guardConfig.isGuardEnabled("gsec1", "antibot"), "antibot aurait dû être désactivé via !!");
    await handleSecurityAliasTextCommand(null, fakeMessage({ guildId: "gsec1", content: "!!antibot on" }));
    assert.ok(guardConfig.isGuardEnabled("gsec1", "antibot"), "antibot aurait dû être réactivé via !!");
  });

  await cas('"&antibot off" ne fait PLUS rien', async () => {
    permStore.grantToUser("gsec2", "staff-1", "protection.guard.manage");
    await handleSecurityAliasTextCommand(null, fakeMessage({ guildId: "gsec2", content: "!!antinuke on" }));
    await handleMusicTextCommand(null, fakeMessage({ guildId: "gsec2", content: "&antibot off" }));
    assert.ok(guardConfig.isGuardEnabled("gsec2", "antibot"), "&antibot off ne doit plus rien changer");
  });

  await cas('"!!antinuke on" active l’anti-nuke', async () => {
    permStore.grantToUser("gsec3", "staff-1", "protection.guard.manage");
    await handleSecurityAliasTextCommand(null, fakeMessage({ guildId: "gsec3", content: "!!antinuke on" }));
    assert.strictEqual(guardConfig.getConfig("gsec3").enabled, true);
  });

  await cas('"&antinuke on" ne fait PLUS rien', async () => {
    permStore.grantToUser("gsec4", "staff-1", "protection.guard.manage");
    await handleMusicTextCommand(null, fakeMessage({ guildId: "gsec4", content: "&antinuke on" }));
    assert.strictEqual(guardConfig.getConfig("gsec4").enabled, false);
  });

  await cas('"-panel" (gestion) est muet sur le préfixe modération', async () => {
    const msg = fakeMessage({ guildId: "gg1", authorId: "staff-panel", content: "-panel" });
    await handleMusicTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0, "-panel ne doit rien faire");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();