/**
 * Appelle CHAQUE commande du préfixe "&" une par une et vérifie qu'aucune ne
 * plante (utils/musicCommands.js::modHandlers).
 *
 * Les tests par famille vérifient qu'une commande fait la bonne chose ; celui-ci
 * vérifie la seule chose qu'ils ne peuvent pas couvrir toutes ensemble : qu'aucun
 * handler ne casse à l'appel — import manquant, déstructuration d'un objet
 * absent, argument non gardé. Une commande qui lève dans le salon affiche
 * "Une erreur est survenue" (voir index.js) : c'est précisément ce qu'on ne
 * veut jamais voir.
 *
 * Chaque commande est appelée SANS aucun droit et avec des arguments vides :
 * la plupart doivent sortir en silence (le préfixe est partagé avec le
 * CrowBot), aucune ne doit lever.
 *
 * Lancement : node scripts/test-commands-smoke.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "smoke-test-"));
process.env.BOT_OWNER_IDS = "un-autre-que-le-testeur";

const { Collection, PermissionsBitField, ChannelType } = require("discord.js");
const { MOD_COMMAND_NAMES } = require("../utils/musicCommands");

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

/** Récupère la table réelle, sans la recopier. */
function loadHandlers() {
  const src = fs.readFileSync(path.join(__dirname, "..", "utils", "musicCommands.js"), "utf8");
  assert.ok(src.includes("const modHandlers = {"), "la table de dispatch a changé de nom");
  return MOD_COMMAND_NAMES;
}

/** Le client passé aux handlers : les commandes publiques s'en servent vraiment. */
const fakeClient = () => ({
  user: { id: "bot", tag: "bot#0000" },
  users: { fetch: async () => null },
  channels: { cache: new Collection() },
  snipes: new Collection(),
});

function fakeMessage(content) {
  const channel = {
    id: "c1",
    name: "salon",
    type: ChannelType.GuildText,
    toString: () => "<#c1>",
    send: async () => ({ id: "m1", edit: async () => {} }),
    messages: { fetch: async () => new Collection() },
    permissionsFor: () => new PermissionsBitField(PermissionsBitField.All),
    permissionOverwrites: { cache: new Collection(), edit: async () => {} },
    setRateLimitPerUser: async () => {},
    awaitMessages: async () => {
      throw new Error("time");
    },
  };
  const everyone = { id: "g1", name: "@everyone" };
  const guild = {
    id: "g1",
    name: "Serveur",
    ownerId: "quelquun-dautre",
    memberCount: 1,
    premiumTier: 0,
    premiumSubscriptionCount: 0,
    createdTimestamp: 1600000000000,
    iconURL: () => null,
    roles: { cache: new Collection([["g1", everyone]]), everyone, create: async () => ({ id: "new" }) },
    channels: { cache: new Collection([["c1", channel]]), create: async () => channel },
    members: {
      cache: new Collection(),
      me: { id: "bot", roles: { highest: { position: 10 } }, permissions: new PermissionsBitField(PermissionsBitField.All) },
      fetch: async () => null,
    },
    emojis: { cache: new Collection() },
    voiceStates: { cache: new Collection() },
    bans: { fetch: async () => null, remove: async () => {} },
    fetchOwner: async () => null,
  };
  // Un vrai GuildMember a toujours .user (un User complet) et .voice, même
  // hors vocal : les omettre ferait échouer le test là où la production
  // fonctionne, et masquerait les vrais plantages sous du bruit.
  const utilisateur = {
    id: "testeur",
    tag: "testeur#0001",
    bot: false,
    createdTimestamp: 1600000000000,
    displayAvatarURL: () => "https://avatar",
    bannerURL: () => null,
  };

  return {
    content: `&${content}`,
    author: utilisateur,
    // Aucun rôle, pas propriétaire, aucune permission Discord : le cas le plus
    // fréquent, et celui où toute commande doit sortir proprement.
    member: {
      id: "testeur",
      guild,
      roles: { cache: new Collection(), highest: { position: 1 } },
      permissions: new PermissionsBitField(),
      user: utilisateur,
      voice: { channel: null },
      joinedTimestamp: 1700000000000,
      joinedAt: new Date(1700000000000),
      communicationDisabledUntil: null,
      premiumSince: null,
    },
    guild,
    channel,
    client: fakeClient(),
    mentions: { users: new Collection(), members: new Collection(), roles: new Collection(), channels: new Collection(), everyone: false },
    attachments: { first: () => null },
    reply: async () => ({}),
  };
}

(async () => {
  const noms = loadHandlers();
  console.log(`Appel des ${noms.length} commandes du préfixe "&" :\n`);

  const casses = [];
  for (const nom of noms) {
    const { MOD_COMMAND_NAMES: _ignore, ...rest } = require("../utils/musicCommands");
    // On passe par le dispatcher public plutôt que par la table interne :
    // c'est le chemin qu'emprunte un vrai message.
    const { handleMusicTextCommand } = rest;
    try {
      await handleMusicTextCommand(fakeClient(), fakeMessage(nom));
    } catch (err) {
      casses.push(`${nom} → ${err.message}`);
    }
  }

  await cas("aucune commande ne lève quand elle est tapée sans droits ni arguments", () => {
    assert.deepStrictEqual(casses, [], `commandes qui plantent :\n    ${casses.join("\n    ")}`);
  });

  await cas("la table de dispatch n'est pas vide et couvre bien tout le préfixe", () => {
    assert.ok(noms.length > 100, `${noms.length} commandes seulement`);
    for (const attendue of ["help", "panel", "kick", "ban", "calc", "modlog", "antibot", "antispam", "prefix"]) {
      assert.ok(noms.includes(attendue), `${attendue} a disparu de la table`);
    }
  });

  await cas("aucun nom de commande en double dans la table", () => {
    assert.strictEqual(new Set(noms).size, noms.length);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
