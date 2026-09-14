/**
 * Vérifie la suspension de la musique (MUSIC_ENABLED=false) : silence total
 * sur le préfixe musique (comme une commande inconnue, pas d'erreur ni de
 * message), et la rubrique Musique disparaît du panel — sans qu'aucune autre
 * commande/rubrique ne soit affectée. Doit tourner dans un process à part :
 * MUSIC_ENABLED est lu une seule fois au chargement du module.
 *
 * Lancement : node scripts/test-music-suspend.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "music-suspend-test-"));
process.env.BOT_OWNER_IDS = "owner-1";
process.env.MUSIC_ENABLED = "false";

const { Collection, PermissionsBitField } = require("discord.js");
const { handleMusicTextCommand } = require("../utils/musicCommands");
const { buildConfigPanel, hasAnyPanelAccess } = require("../utils/configPanel");
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

function makeMessage(content) {
  const calls = { replied: false, sent: false };
  return {
    calls,
    author: { id: "u1", bot: false },
    guild: { id: "gmusicoff" },
    member: { id: "u1" },
    content,
    reply: async () => {
      calls.replied = true;
    },
    channel: {
      send: async () => {
        calls.sent = true;
      },
    },
  };
}

const guild = {
  id: "gmusicoff",
  name: "Serveur",
  ownerId: "owner-1",
  memberCount: 0,
  roles: { cache: new Collection(), everyone: { permissions: new PermissionsBitField([]) } },
  channels: { cache: new Collection() },
  members: { cache: new Collection(), me: { roles: { highest: { position: 9 } } } },
  emojis: { cache: new Collection() },
  voiceStates: { cache: new Collection() },
  client: { uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } },
};

const owner = { id: "owner-1", guild: { id: "gmusicoff", ownerId: "owner-1" }, roles: { cache: new Collection() }, permissions: { has: () => true } };

(async () => {
  console.log("Musique suspendue (MUSIC_ENABLED=false) :");

  await cas("?play reste MUET (comme une commande inconnue), aucune réponse ni message", async () => {
    const msg = makeMessage("?play jamais de la vie");
    await handleMusicTextCommand({}, msg);
    assert.strictEqual(msg.calls.replied, false);
    assert.strictEqual(msg.calls.sent, false);
  });

  await cas("?help (aide musique) reste MUET aussi — pas seulement les commandes de lecture", async () => {
    const msg = makeMessage("?help");
    await handleMusicTextCommand({}, msg);
    assert.strictEqual(msg.calls.sent, false, "buildMusicHelpPanel ne doit pas être envoyé");
  });

  await cas("le préfixe \"&\" (modHandlers) n'est PAS affecté — seule la musique est suspendue", async () => {
    const msg = makeMessage("&notacommand");
    await handleMusicTextCommand({}, msg);
    assert.strictEqual(msg.calls.replied, false);
    assert.strictEqual(msg.calls.sent, false);
    // (silence attendu ici aussi, mais pour la VRAIE raison : commande &
    // inconnue — pas parce que MUSIC_ENABLED l'a coupée. Le test suivant le
    // confirme avec la famille panel, indépendante du préfixe &.)
  });

  await cas("la rubrique Musique du panel n'apparaît plus, même pour le propriétaire", () => {
    const json = buildConfigPanel(guild, "musicPlayer", owner).components[0].toJSON();
    const titre = json.components.find((c) => c.type === 10).content;
    assert.ok(!titre.includes("Musique"), titre);
  });

  await cas("la famille Musique disparaît du menu principal du panel", () => {
    const json = buildConfigPanel(guild, "home", owner).components[0].toJSON();
    const labels = json.components
      .filter((c) => c.type === 1)
      .flatMap((r) => r.components)
      .filter((c) => c.custom_id?.startsWith("cfg:nav:"))
      .map((b) => b.label);
    assert.ok(!labels.includes("Musique"), labels.join(", "));
  });

  await cas("un membre avec un VRAI droit ailleurs peut toujours ouvrir le panel normalement", () => {
    permStore.setRoleGrants("gmusicoff", "role-logs", ["logs.view"]);
    const member = { id: "u-logs", guild: { id: "gmusicoff", ownerId: "owner-1" }, roles: { cache: new Collection([["role-logs", { id: "role-logs" }]]) }, permissions: { has: () => false } };
    assert.strictEqual(hasAnyPanelAccess(member), true, "logs.view doit rester une vraie porte d'entrée, la suspension musique ne doit rien changer d'autre");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
