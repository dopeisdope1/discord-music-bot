/**
 * Vérifie les commandes de logs (utils/logCommands.js) : &modlog/&messagelog/
 * &voicelog/&rolelog/... écrivent dans le MÊME store que &panel > Logs
 * (utils/modLogStore.js), et &autoconfiglog appelle la MÊME création
 * automatique que le bouton du panel (utils/logChannels.js).
 *
 * Lancement : node scripts/test-log-commands.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "logcmd-test-"));
process.env.BOT_OWNER_IDS = "staff-1";

const { Collection, ChannelType, PermissionsBitField } = require("discord.js");
const permStore = require("../utils/permissions/store");
const { logHandlers, COMMAND_TO_CATEGORY } = require("../utils/logCommands");
const { getAllLogChannels, setLogChannelId } = require("../utils/modLogStore");

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

const ROLE = "role-logs";
permStore.setRoleGrants("g1", ROLE, ["logs.manage", "logs.view"]);

function makeChannel(id, type = ChannelType.GuildText, writable = true) {
  return {
    id,
    type,
    toString: () => `<#${id}>`,
    permissionsFor: () => ({ has: () => writable }),
  };
}

function makeMessage({ args = [], content = "modlog", channels = [], mentionChannel = null, roleId = ROLE, userId = "staff-1" } = {}) {
  const cache = new Collection();
  for (const c of channels) cache.set(c.id, c);
  const courant = channels[0] || makeChannel("c-courant");
  cache.set(courant.id, courant);

  const roles = new Collection();
  if (roleId) roles.set(roleId, { id: roleId });

  const replies = [];
  return {
    content: `&${content}`,
    author: { id: userId, tag: "staff#0001" },
    member: { id: userId, guild: { id: "g1" }, roles: { cache: roles }, permissions: new PermissionsBitField() },
    guild: {
      id: "g1",
      channels: { cache },
      members: { me: { id: "bot" } },
      roles: { everyone: { id: "g1" } },
    },
    channel: courant,
    mentions: { channels: new Collection(mentionChannel ? [[mentionChannel.id, mentionChannel]] : []) },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
    _args: args,
  };
}

const texte = (msg) => msg._replies[0]?.embeds?.[0]?.data?.description || "";

(async () => {
  console.log("Activation / désactivation par catégorie :");

  await cas("chaque commande vise bien sa propre catégorie du store", () => {
    assert.deepStrictEqual(COMMAND_TO_CATEGORY.modlog, "moderation");
    assert.deepStrictEqual(COMMAND_TO_CATEGORY.messagelog, "messages");
    assert.deepStrictEqual(COMMAND_TO_CATEGORY.voicelog, "voice");
    // Toutes les catégories du store ont une commande, aucune n'est orpheline.
    const couvertes = new Set(Object.values(COMMAND_TO_CATEGORY));
    for (const category of Object.keys(getAllLogChannels("g-vide"))) {
      assert.ok(couvertes.has(category), `la catégorie ${category} n'a aucune commande`);
    }
  });

  await cas("`modlog on #salon` enregistre le salon mentionné", async () => {
    const salon = makeChannel("c-logs");
    const msg = makeMessage({ channels: [makeChannel("c-courant"), salon], mentionChannel: salon });
    await logHandlers.modlog(null, msg, ["on", "<#c-logs>"]);
    assert.strictEqual(getAllLogChannels("g1").moderation, "c-logs");
  });

  await cas("`modlog on` sans salon prend le salon courant", async () => {
    const courant = makeChannel("c-ici");
    const msg = makeMessage({ channels: [courant] });
    await logHandlers.voicelog(null, msg, ["on"]);
    assert.strictEqual(getAllLogChannels("g1").voice, "c-ici");
  });

  await cas("`off` désactive la catégorie sans toucher aux autres", async () => {
    await logHandlers.voicelog(null, makeMessage(), ["off"]);
    assert.strictEqual(getAllLogChannels("g1").voice, null);
    assert.strictEqual(getAllLogChannels("g1").moderation, "c-logs", "les autres catégories ne bougent pas");
  });

  await cas("sans argument, la commande affiche l'état au lieu de ne rien faire", async () => {
    const msg = makeMessage({ content: "modlog" });
    await logHandlers.modlog(null, msg, []);
    assert.ok(texte(msg).includes("c-logs"), texte(msg));
  });

  console.log("\nRefus explicites plutôt que des logs qui disparaissent :");

  await cas("un salon vocal est refusé", async () => {
    const vocal = makeChannel("c-vocal", ChannelType.GuildVoice);
    const msg = makeMessage({ channels: [makeChannel("c-courant"), vocal], mentionChannel: vocal });
    await logHandlers.rolelog(null, msg, ["on", "<#c-vocal>"]);
    assert.ok(texte(msg).includes("salon écrit"), texte(msg));
    assert.strictEqual(getAllLogChannels("g1").roles, null);
  });

  await cas("un salon où le bot ne peut pas écrire est refusé", async () => {
    const muet = makeChannel("c-muet", ChannelType.GuildText, false);
    const msg = makeMessage({ channels: [makeChannel("c-courant"), muet], mentionChannel: muet });
    await logHandlers.botlog(null, msg, ["on", "<#c-muet>"]);
    assert.ok(texte(msg).includes("ne peut pas écrire"), texte(msg));
    assert.strictEqual(getAllLogChannels("g1").bots, null);
  });

  await cas("sans le droit logs.manage, la commande reste muette", async () => {
    // Un membre ordinaire : ni rôle habilité, ni propriétaire du bot (qui
    // passerait outre toutes les permissions et ne prouverait rien ici).
    const msg = makeMessage({ roleId: null, userId: "membre-lambda" });
    await logHandlers.modlog(null, msg, ["off"]);
    assert.strictEqual(msg._replies.length, 0, "aucune réponse — le préfixe est partagé avec le CrowBot");
    assert.strictEqual(getAllLogChannels("g1").moderation, "c-logs", "et rien n'a été modifié");
  });

  console.log("\n&settings — résumé :");

  await cas("liste toutes les catégories, configurées ou non", async () => {
    const msg = makeMessage();
    await logHandlers.settings(null, msg);
    const body = texte(msg);
    assert.ok(body.includes("modlog"), "la commande à taper est rappelée");
    assert.ok(body.includes("<#c-logs>"), "les salons configurés sont affichés");
    assert.ok(body.includes("désactivé"), "les catégories vides aussi");
  });

  console.log("\n&autoconfiglog — même création que le bouton du panel :");

  await cas("crée un salon par catégorie manquante et les enregistre", async () => {
    setLogChannelId("g2", "moderation", null);
    const crees = [];
    const guild = {
      id: "g2",
      roles: { everyone: { id: "g2" } },
      channels: {
        cache: new Collection(),
        create: async (opts) => {
          const salon = makeChannel(`new-${crees.length}`);
          salon.name = opts.name;
          crees.push(opts.name);
          return salon;
        },
      },
    };
    const msg = makeMessage();
    msg.guild = guild;
    await logHandlers.autoconfiglog(null, msg);

    // 1 catégorie Discord + 8 salons de logs
    assert.strictEqual(crees.length, 9, crees.join(", "));
    assert.ok(crees.includes("Logs"), "les salons sont regroupés dans une catégorie");
    assert.ok(crees.includes("logs-moderation"));
    const configures = Object.values(getAllLogChannels("g2")).filter(Boolean).length;
    assert.strictEqual(configures, 8, "les 8 catégories doivent être enregistrées");
  });

  await cas("relancée, elle ne recrée rien", async () => {
    let creations = 0;
    const guild = {
      id: "g2",
      roles: { everyone: { id: "g2" } },
      channels: {
        cache: new Collection(Object.values(getAllLogChannels("g2")).filter(Boolean).map((id) => [id, makeChannel(id)])),
        create: async () => {
          creations++;
          return makeChannel("x");
        },
      },
    };
    const msg = makeMessage();
    msg.guild = guild;
    await logHandlers.autoconfiglog(null, msg);
    assert.strictEqual(creations, 0, "idempotent");
    assert.ok(texte(msg).includes("déjà"), texte(msg));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
