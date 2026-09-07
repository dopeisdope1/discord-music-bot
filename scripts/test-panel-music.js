/**
 * Vérifie la rubrique Musique du panel (module 8 de la refonte) : affiche le
 * lecteur en cours en lecture seule et relie vers le VRAI panneau de lecture
 * suivi par utils/musicPlayer.js (jamais une copie de ses boutons music_*,
 * qui casserait le suivi/rafraîchissement existant) + le même bouton "Mes
 * favoris" que le panneau de lecture (utils/favoritesPanel.js).
 *
 * Couvre aussi une régression trouvée en écrivant ce module : la rubrique
 * Musique n'est gated par AUCUNE permission (comme &play), donc
 * hasAnyPanelAccess doit continuer à ignorer les rubriques publiques —
 * sinon &panel deviendrait accessible à quiconque n'a strictement aucun
 * droit.
 *
 * Lancement : node scripts/test-panel-music.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-music-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { buildConfigPanel, handleConfigInteraction, hasAnyPanelAccess, ID } = require("../utils/configPanel");
const favoritesStore = require("../utils/favoritesStore");
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

function makeGuild(client) {
  return {
    id: "gmusic",
    name: "Serveur",
    ownerId: "owner-1",
    memberCount: 0,
    roles: { cache: new Collection(), everyone: { permissions: new PermissionsBitField([]) } },
    channels: { cache: new Collection() },
    members: { cache: new Collection(), me: { roles: { highest: { position: 9 } } } },
    emojis: { cache: new Collection() },
    voiceStates: { cache: new Collection() },
    client,
  };
}

function mkMember(id, roleId) {
  return {
    id,
    guild: { id: "gmusic", ownerId: "owner-1" },
    roles: { cache: roleId ? new Collection([[roleId, { id: roleId }]]) : new Collection() },
    permissions: { has: () => false },
  };
}

function render(guild, member) {
  const json = buildConfigPanel(guild, "musicPlayer", member).components[0].toJSON();
  return {
    texte: json.components.filter((c) => c.type === 10).map((c) => c.content).join("\n"),
    boutons: json.components.filter((c) => c.type === 1).flatMap((r) => r.components),
  };
}

(async () => {
  console.log("Musique — lecteur en cours et favoris :");

  const noAccess = mkMember("u-none");

  await cas("un membre sans AUCUN droit peut voir la rubrique Musique (comme &play, non gated)", () => {
    const guild = makeGuild({ uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } });
    const json = buildConfigPanel(guild, "musicPlayer", noAccess).components[0].toJSON();
    const titre = json.components.find((c) => c.type === 10).content;
    assert.ok(titre.includes("Musique"), titre);
  });

  await cas("mais ce même membre ne peut PAS ouvrir &panel (régression : une rubrique publique ne doit pas suffire)", () => {
    assert.strictEqual(hasAnyPanelAccess(noAccess), false);
  });

  await cas("sans lecture en cours, la rubrique le dit clairement", () => {
    const guild = makeGuild({ uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } });
    const { texte, boutons } = render(guild, noAccess);
    assert.ok(texte.includes("Aucune lecture en cours"), texte);
    assert.ok(!boutons.some((b) => b.label === "Ouvrir le lecteur"), "pas de lien vers un lecteur qui n'existe pas");
  });

  await cas("avec une lecture en cours ET un panneau suivi, la fiche affiche le VRAI état et lie vers le VRAI message", () => {
    const track = { title: "Track Test", uri: "https://example.com/t", requester: { id: "222222222222222222" }, length: 180000 };
    const player = { queue: Object.assign([], { current: track, length: 2 }), paused: false, volume: 80, loop: "track" };
    const client = {
      uptime: 1,
      ws: { ping: 1 },
      guilds: { cache: new Collection() },
      kazagumo: { players: new Collection([["gmusic", player]]) },
      nowPlayingMessages: new Collection([["gmusic", { url: "https://discord.com/channels/gmusic/1/2" }]]),
    };
    const guild = makeGuild(client);
    const { texte, boutons } = render(guild, noAccess);
    assert.ok(texte.includes("Track Test"), texte);
    assert.ok(texte.includes("lecture") && texte.includes("80%"), texte);
    const lienBouton = boutons.find((b) => b.label === "Ouvrir le lecteur");
    assert.ok(lienBouton, "le lien vers le vrai panneau de lecture doit apparaître");
    assert.strictEqual(lienBouton.url, "https://discord.com/channels/gmusic/1/2");
  });

  // &panel reste un outil admin : un membre sans AUCUN droit ne peut cliquer
  // sur RIEN dans le panel (même un bouton "public" comme musicfavlist), tout
  // simplement parce qu'il ne peut pas ouvrir &panel pour y accéder. Ces deux
  // derniers cas vérifient donc le bouton avec un admin qui a un droit
  // QUELCONQUE (logs.view, sans rapport avec la musique) — pas le membre
  // complètement dépourvu de droits utilisé au-dessus.
  permStore.setRoleGrants("gmusic", "role-any", ["logs.view"]);
  const anyAdmin = mkMember("u-admin", "role-any");

  await cas('"Mes favoris" sans aucun favori le dit clairement, sans planter', async () => {
    const guild = makeGuild({ uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } });
    let replied = null;
    await handleConfigInteraction({
      customId: `${ID}:musicfavlist`,
      member: anyAdmin,
      guild,
      user: { id: "u-admin" },
      reply: async (p) => {
        replied = p;
      },
    });
    assert.ok(replied.content.includes("aucun favori"), JSON.stringify(replied));
  });

  await cas('"Mes favoris" avec des favoris renvoie la VRAIE liste (utils/favoritesPanel.js), en éphémère', async () => {
    favoritesStore.toggle("u-admin", { uri: "https://example.com/fav", title: "Favori Test", author: "Artiste", length: 200000 });
    const guild = makeGuild({ uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() } });
    let replied = null;
    await handleConfigInteraction({
      customId: `${ID}:musicfavlist`,
      member: anyAdmin,
      guild,
      user: { id: "u-admin" },
      reply: async (p) => {
        replied = p;
      },
    });
    const { MessageFlags } = require("discord.js");
    const texte = replied.components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(texte.includes("Favori Test"), texte);
    assert.ok((replied.flags & MessageFlags.Ephemeral) === MessageFlags.Ephemeral, replied.flags);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
