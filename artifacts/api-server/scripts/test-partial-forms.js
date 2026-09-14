/**
 * Vérifie qu'une commande tapée avec des arguments STRUCTURELS insuffisants
 * (ex: "&addrole @membre" sans rôle) ouvre sa carte interactive PRÉ-REMPLIE
 * avec ce qui a déjà été donné, plutôt que d'échouer sur un message
 * d'erreur — signalé explicitement ("&addrole @uo" donnait "Indique un
 * membre ET un rôle" au lieu d'ouvrir la carte). Vérifie aussi que rien ne
 * change quand tout le nécessaire est déjà fourni (exécution directe, comme
 * avant) ou quand seul un champ TEXTE optionnel manque (kick sans raison).
 *
 * Lancement : node scripts/test-partial-forms.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "partialforms-test-"));
process.env.BOT_OWNER_IDS = "staff-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { handleMusicTextCommand } = require("../utils/musicCommands");
const commandForms = require("../utils/commandForms");

const TARGET_ID = "999888777000111222";
const ROLE_ID = "333333333333333333";

function makeGuild() {
  return {
    id: "g1",
    ownerId: "owner-x",
    roles: { cache: new Collection([[ROLE_ID, { id: ROLE_ID, name: "Testeur", position: 2 }]]), everyone: { id: "everyone" } },
    channels: { cache: new Collection() },
    members: { me: { permissions: new PermissionsBitField(PermissionsBitField.All), roles: { highest: { position: 10 } } }, fetch: async () => null },
  };
}

function makeMessage(guild, content, { mentionedMember, mentionedRole } = {}) {
  const replies = [];
  return {
    author: { id: "staff-1", tag: "staff#0001", bot: false },
    member: {
      id: "staff-1",
      guild,
      roles: { cache: new Collection(), highest: { position: 5 } },
      permissions: new PermissionsBitField(PermissionsBitField.All),
    },
    guild,
    channel: { id: "c1" },
    content,
    mentions: {
      users: new Collection(),
      members: new Collection(mentionedMember ? [[mentionedMember.id, mentionedMember]] : []),
      roles: new Collection(mentionedRole ? [[mentionedRole.id, mentionedRole]] : []),
      channels: new Collection(),
    },
    reply: async (p) => {
      replies.push(p);
      return {};
    },
    _replies: replies,
  };
}

const isCard = (msg) => msg._replies[0]?.flags !== undefined;

let reussis = 0;
async function cas(nom, fn) {
  try {
    await fn();
    reussis++;
    console.log(`  ok — ${nom}`);
  } catch (err) {
    console.error(`  ÉCHEC — ${nom}\n    ${err.message}`);
    process.exitCode = 1;
  }
}

(async () => {
  console.log("Arguments structurels insuffisants -> carte pré-remplie :");

  await cas('"&addrole @membre" (rôle manquant) ouvre la carte, pré-remplie', async () => {
    const guild = makeGuild();
    const mentionedMember = { id: TARGET_ID, user: { id: TARGET_ID, tag: "cible#0001" }, roles: { cache: new Collection() } };
    const msg = makeMessage(guild, `&addrole <@${TARGET_ID}>`, { mentionedMember });
    await handleMusicTextCommand({}, msg);
    assert.strictEqual(isCard(msg), true);
    assert.strictEqual(commandForms.getFormState("staff-1", "addrole_member")?.userId, TARGET_ID);
  });

  await cas('"&addrole @rôle" (membre manquant) ouvre la carte, pré-remplie côté rôle', async () => {
    const guild = makeGuild();
    const roleObj = { id: ROLE_ID, name: "Testeur", position: 2 };
    const msg = makeMessage(guild, `&addrole <@&${ROLE_ID}>`, { mentionedRole: roleObj });
    await handleMusicTextCommand({}, msg);
    assert.strictEqual(isCard(msg), true);
    assert.strictEqual(commandForms.getFormState("staff-1", "addrole_member")?.roleId, ROLE_ID);
  });

  console.log("\nArguments complets -> exécution directe inchangée :");

  await cas('"&addrole @membre @rôle" (complet) exécute directement, pas de carte', async () => {
    const guild = makeGuild();
    const mentionedMember = {
      id: TARGET_ID,
      user: { id: TARGET_ID, tag: "cible#0001" },
      roles: { cache: new Collection(), highest: { position: 1 }, add: async function (r) { this._added = r.id; } },
    };
    const roleObj = { id: ROLE_ID, name: "Testeur", position: 2 };
    const msg = makeMessage(guild, `&addrole <@${TARGET_ID}> <@&${ROLE_ID}>`, { mentionedMember, mentionedRole: roleObj });
    await handleMusicTextCommand({}, msg);
    assert.strictEqual(isCard(msg), false);
    assert.strictEqual(mentionedMember.roles._added, ROLE_ID);
  });

  await cas('"&kick @membre" (raison optionnelle absente) exécute directement, pas de carte', async () => {
    const guild = makeGuild();
    const mentionedMember = {
      id: TARGET_ID,
      user: { id: TARGET_ID, tag: "cible#0001" },
      roles: { cache: new Collection(), highest: { position: 1 } },
      kick: async function (r) {
        this._kicked = r;
      },
    };
    guild.members.fetch = async (id) => (id === TARGET_ID ? mentionedMember : null);
    const msg = makeMessage(guild, `&kick <@${TARGET_ID}>`, { mentionedMember });
    await handleMusicTextCommand({}, msg);
    assert.strictEqual(isCard(msg), false);
    assert.ok(mentionedMember._kicked !== undefined);
  });

  console.log("\nChamps \"salon\" implicites (jamais une mention dans la syntaxe réelle) :");

  await cas('"&giveaway start 1h Nitro" (complet, salon implicite) lance réellement le giveaway, pas de carte vide', async () => {
    // Bug réel trouvé en testant : "channel" faisait partie des champs
    // STRUCTURELS requis par structuralFieldsSatisfied, alors que la
    // syntaxe texte de &giveaway ne fournit JAMAIS de salon en mention (il
    // poste toujours dans le salon courant) — la commande complète ouvrait
    // donc une carte vide au lieu de s'exécuter.
    const guild = makeGuild();
    let posted = null;
    const channel = {
      id: "c1",
      send: async (p) => {
        posted = p;
        return { id: "msg1", edit: async () => {} };
      },
    };
    guild.channels.cache.set("c1", channel);
    const msg = makeMessage(guild, "&giveaway start 1h Nitro");
    msg.channel = channel;
    await handleMusicTextCommand({}, msg);
    assert.strictEqual(isCard(msg), false, "ne doit pas ouvrir de carte");
    assert.ok(posted, "le giveaway doit être posté dans le salon");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
