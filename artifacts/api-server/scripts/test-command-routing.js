/**
 * Routage 2 préfixes (utils/commandRouting.js + le dispatch de
 * utils/musicCommands.js) : chaque mot de commande est servi par UN seul
 * préfixe selon sa catégorie.
 *   & = gestion, - = modération.
 * Déplacement DUR : un mot de modération ne répond PLUS sur "&".
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
  console.log("Les 2 préfixes existent et sont distincts :");

  await cas("main/musicMod/moderation = ? & -", () => {
    const p = getPrefixes("g-x");
    assert.strictEqual(p.musicMod, "&");
    assert.strictEqual(p.moderation, "-");
    const vals = [p.musicMod, p.moderation];
    assert.strictEqual(new Set(vals).size, 2, "les 2 préfixes doivent être distincts");
  });

  await cas("les anciennes données de préfixe récupèrent les familles ajoutées", () => {
    const p = getPrefixes("legacy");
    assert.strictEqual(p.musicMod, "~", "la valeur persistée doit rester prioritaire");
    assert.strictEqual(p.moderation, "-", "la modération absente doit reprendre son défaut");
  });

  console.log("\nbucketDe : chaque mot vers sa catégorie :");

  await cas("modération : ban/kick/mute/warn/clear/lockdown → moderation", () => {
    for (const w of ["ban", "kick", "mute", "warn", "clear", "lockdown", "purge", "cmute"]) {
      assert.strictEqual(routing.bucketDe(w), "moderation", `${w} devrait être modération`);
    }
  });

  await cas("gestion : ticket/poll/giveaway/role/panel/backup/set/allbots → gestion", () => {
    for (const w of ["ticket", "poll", "giveaway", "role", "channel", "panel", "backup", "set", "autorole", "verify", "alladmins", "botadmins", "allbots"]) {
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

  console.log('\nSécurité serveur migrée vers le bot Secure : plus aucune trace ici :');

  await cas('"&antinuke on"/"&wl"/"!!antinuke" ne font plus rien sur ce bot', async () => {
    const msg1 = fakeMessage({ guildId: "gsec1", content: "&antinuke on" });
    await handleMusicTextCommand(null, msg1);
    assert.strictEqual(msg1._replies.length, 0, "&antinuke ne doit plus exister sur le bot principal");

    const msg2 = fakeMessage({ guildId: "gsec2", content: "!!antinuke on" });
    await handleMusicTextCommand(null, msg2);
    assert.strictEqual(msg2._replies.length, 0, "!!antinuke n'a jamais existé sur le préfixe & et le préfixe !! n'existe plus");
  });

  await cas('"-panel" (gestion) est muet sur le préfixe modération', async () => {
    const msg = fakeMessage({ guildId: "gg1", authorId: "staff-panel", content: "-panel" });
    await handleMusicTextCommand(null, msg);
    assert.strictEqual(msg._replies.length, 0, "-panel ne doit rien faire");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();