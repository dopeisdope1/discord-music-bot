/**
 * Vérifie la configuration en un clic du voicehub (&panel > Communauté >
 * Vocaux, boutons "Créer la configuration" / "Modifier les noms") :
 *  - utils/voiceChannels.js : catégorie de destination, salon-panneau
 *    partagé et modèle de nom, persistés séparément du fichier existant
 *    (voir CONFIG_FILE) ;
 *  - utils/voiceHubSetup.js : crée les DEUX catégories, le générateur ET le
 *    salon-panneau partagé en un seul appel, refuse de dupliquer si un
 *    générateur est déjà actif ;
 *  - utils/configPanel.js : les boutons appellent bien ce qui précède, avec
 *    les vérifications de droits habituelles.
 *
 * Lancement : node scripts/test-voice-hub-setup.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "voicehubsetup-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, ChannelType } = require("discord.js");
const voiceChannels = require("../utils/voiceChannels");
const voiceHubSetup = require("../utils/voiceHubSetup");
const configPanel = require("../utils/configPanel");
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

function makeGuild(id) {
  const channelsCache = new Collection();
  const created = [];
  return {
    id,
    name: "Test",
    members: { cache: new Collection(), me: { id: "bot-1" } },
    roles: { cache: new Collection(), everyone: { id } },
    channels: {
      cache: channelsCache,
      create: async (opts) => {
        const ch = {
          id: `ch-${created.length + 1}`,
          name: opts.name,
          type: opts.type,
          parentId: opts.parent || null,
          _messages: new Map(),
          _nextMsgId: 1,
          send: function (payload) {
            const msg = {
              id: `msg-${this._nextMsgId++}`,
              content: payload,
              edit: async (p) => {
                msg.content = p;
              },
            };
            this._messages.set(msg.id, msg);
            return Promise.resolve(msg);
          },
        };
        ch.messages = {
          fetch: async (id) => ch._messages.get(id) || Promise.reject(new Error("Unknown Message")),
        };
        created.push(ch);
        channelsCache.set(ch.id, ch);
        return ch;
      },
    },
    _created: created,
  };
}

function makeMember(guild) {
  return { id: "owner-1", guild, roles: { cache: new Collection(), highest: { position: 10 } } };
}

(async () => {
  console.log("Modèle de nom et salon-panneau (utils/voiceChannels.js) :");

  await cas("valeurs par défaut sans config enregistrée", () => {
    const config = voiceChannels.getHubConfig("g-defaut");
    assert.strictEqual(config.spawnCategoryId, null);
    assert.strictEqual(config.panelChannelId, null);
    assert.strictEqual(config.voiceNameTemplate, "Salon de {pseudo}");
  });

  await cas("setSpawnCategory / setPanelChannel / setNameTemplates persistent bien, sans se marcher dessus", () => {
    voiceChannels.setSpawnCategory("g1", "cat-1");
    voiceChannels.setPanelChannel("g1", "panel-1");
    voiceChannels.setNameTemplates("g1", { voiceNameTemplate: "🔊 {pseudo}" });
    const config = voiceChannels.getHubConfig("g1");
    assert.strictEqual(config.spawnCategoryId, "cat-1");
    assert.strictEqual(config.panelChannelId, "panel-1");
    assert.strictEqual(config.voiceNameTemplate, "🔊 {pseudo}");
  });

  await cas("formatTemplate remplace {pseudo} partout où il apparaît", () => {
    assert.strictEqual(voiceChannels.formatTemplate("Salon de {pseudo}", "uo"), "Salon de uo");
    assert.strictEqual(voiceChannels.formatTemplate("{pseudo} | vocal", "uo"), "uo | vocal");
  });

  await cas("un modèle sans {pseudo} ajoute le pseudo à la fin, pas de collision entre membres", () => {
    assert.strictEqual(voiceChannels.formatTemplate("Salon vocal", "uo"), "Salon vocal uo");
  });

  await cas("le nom généré reste sous la limite Discord de 100 caractères", () => {
    const long = "x".repeat(150);
    const nom = voiceChannels.formatTemplate("Salon de {pseudo}", long);
    assert.strictEqual(nom.length, 100);
  });

  console.log("\nConstruction en un clic (utils/voiceHubSetup.js) :");

  await cas("crée les deux catégories, le générateur ET le salon-panneau, dans la bonne hiérarchie", async () => {
    const guild = makeGuild("g-setup");
    const { hubCategory, spawnCategory, hubChannel, panelChannel } = await voiceHubSetup.createVoiceHubSetup(guild);

    assert.strictEqual(hubCategory.type, ChannelType.GuildCategory);
    assert.strictEqual(spawnCategory.type, ChannelType.GuildCategory);
    assert.notStrictEqual(hubCategory.id, spawnCategory.id, "les deux catégories doivent être distinctes");
    assert.strictEqual(hubChannel.type, ChannelType.GuildVoice);
    assert.strictEqual(hubChannel.parentId, hubCategory.id, "le générateur doit vivre dans la catégorie dédiée, pas celle des salons créés");
    assert.strictEqual(panelChannel.type, ChannelType.GuildText);
    assert.strictEqual(panelChannel.parentId, spawnCategory.id, "le panneau vit avec les salons créés, pas dans la catégorie du générateur");
  });

  await cas("enregistre le générateur, la catégorie de destination ET le salon-panneau", async () => {
    const guild = makeGuild("g-setup2");
    const { spawnCategory, hubChannel, panelChannel } = await voiceHubSetup.createVoiceHubSetup(guild);
    assert.strictEqual(voiceChannels.getHub("g-setup2"), hubChannel.id);
    const config = voiceChannels.getHubConfig("g-setup2");
    assert.strictEqual(config.spawnCategoryId, spawnCategory.id);
    assert.strictEqual(config.panelChannelId, panelChannel.id);
  });

  await cas("poste bien la carte de contrôle statique dans le salon-panneau", async () => {
    const guild = makeGuild("g-setup2b");
    let sent = null;
    const originalCreate = guild.channels.create;
    guild.channels.create = async (opts) => {
      const ch = await originalCreate(opts);
      if (opts.type === ChannelType.GuildText) ch.send = async (p) => (sent = p);
      return ch;
    };
    await voiceHubSetup.createVoiceHubSetup(guild);
    assert.ok(sent, "rien n'a été posté dans le salon-panneau");
    assert.ok(sent.flags !== undefined, "doit être une carte Components V2");
  });

  console.log("\nActualiser le panneau (message déjà posté vs. disparu) :");

  await cas("enregistre l'ID du message posté, pour pouvoir l'éditer plus tard", async () => {
    const guild = makeGuild("g-refresh1");
    const { panelChannel } = await voiceHubSetup.createVoiceHubSetup(guild);
    const stored = voiceChannels.getHubConfig("g-refresh1").panelMessageId;
    assert.ok(stored, "aucun panelMessageId enregistré");
    assert.ok(panelChannel._messages.has(stored));
  });

  await cas("refreshPanelCard ÉDITE le message existant plutôt que d'en poster un nouveau", async () => {
    const guild = makeGuild("g-refresh2");
    const { panelChannel } = await voiceHubSetup.createVoiceHubSetup(guild);
    const avant = panelChannel._messages.size;
    const ok = await voiceHubSetup.refreshPanelCard(guild);
    assert.strictEqual(ok, true);
    assert.strictEqual(panelChannel._messages.size, avant, "aucun nouveau message ne doit être créé");
  });

  await cas("si le message a été supprimé entre-temps, refreshPanelCard en poste un nouveau et met à jour l'ID", async () => {
    const guild = makeGuild("g-refresh3");
    const { panelChannel } = await voiceHubSetup.createVoiceHubSetup(guild);
    const ancienId = voiceChannels.getHubConfig("g-refresh3").panelMessageId;
    panelChannel._messages.delete(ancienId);
    const ok = await voiceHubSetup.refreshPanelCard(guild);
    assert.strictEqual(ok, true);
    const nouvelId = voiceChannels.getHubConfig("g-refresh3").panelMessageId;
    assert.notStrictEqual(nouvelId, ancienId);
    assert.ok(panelChannel._messages.has(nouvelId));
  });

  await cas("sans salon-panneau configuré du tout, refreshPanelCard renvoie faux sans planter", async () => {
    const guild = makeGuild("g-refresh4");
    const ok = await voiceHubSetup.refreshPanelCard(guild);
    assert.strictEqual(ok, false);
  });

  await cas("isAlreadyConfigured est faux tant que rien n'existe, vrai une fois créé", async () => {
    const guild = makeGuild("g-setup3");
    assert.strictEqual(voiceHubSetup.isAlreadyConfigured(guild), false);
    await voiceHubSetup.createVoiceHubSetup(guild);
    assert.strictEqual(voiceHubSetup.isAlreadyConfigured(guild), true);
  });

  await cas("isAlreadyConfigured redevient faux si le salon générateur a été supprimé entre-temps", async () => {
    const guild = makeGuild("g-setup4");
    const { hubChannel } = await voiceHubSetup.createVoiceHubSetup(guild);
    guild.channels.cache.delete(hubChannel.id);
    assert.strictEqual(voiceHubSetup.isAlreadyConfigured(guild), false);
  });

  console.log("\nBoutons du panel (utils/configPanel.js) :");

  const fakeInteraction = (guild, customId, overrides = {}) => {
    const followUps = [];
    const replies = [];
    let edited = null;
    return {
      customId,
      guild,
      member: makeMember(guild),
      user: { id: "owner-1" },
      isModalSubmit: () => false,
      deferUpdate: async () => {},
      reply: async (p) => {
        replies.push(p);
      },
      update: async (p) => {
        edited = p;
      },
      followUp: async (p) => {
        followUps.push(p);
      },
      message: {
        edit: async (p) => {
          edited = p;
        },
      },
      _replies: replies,
      _followUps: followUps,
      get _edited() {
        return edited;
      },
      ...overrides,
    };
  };

  await cas("\"Créer la configuration\" crée bien tout depuis le bouton du panel", async () => {
    const guild = makeGuild("g-panel1");
    const interaction = fakeInteraction(guild, "cfg:voicehubsetup");
    await configPanel.handleConfigInteraction(interaction);
    assert.strictEqual(guild._created.length, 4, "deux catégories + un salon vocal + le salon-panneau");
    assert.ok(voiceChannels.getHub("g-panel1"));
    assert.ok(voiceChannels.getHubConfig("g-panel1").panelChannelId);
    assert.ok(interaction._followUps[0]?.content.includes("Configuration créée"));
  });

  await cas("un deuxième clic ne recrée rien, juste un message d'info", async () => {
    const guild = makeGuild("g-panel2");
    await voiceHubSetup.createVoiceHubSetup(guild);
    const avant = guild._created.length;
    const interaction = fakeInteraction(guild, "cfg:voicehubsetup");
    await configPanel.handleConfigInteraction(interaction);
    assert.strictEqual(guild._created.length, avant, "rien de plus n'a été créé");
    assert.ok(interaction._replies[0]?.content.includes("déjà actif"));
  });

  await cas("sans le droit server.voice.manage, le bouton ne fait rien", async () => {
    const guild = makeGuild("g-panel3");
    const interaction = fakeInteraction(guild, "cfg:voicehubsetup", { member: { id: "intrus", guild, roles: { cache: new Collection() } } });
    await configPanel.handleConfigInteraction(interaction);
    assert.strictEqual(guild._created.length, 0);
    // Un membre sans AUCUN droit sur le panel est refusé par le garde-fou
    // d'entrée (hasAnyPanelAccess), avant même d'atteindre la vérification
    // spécifique à "voicehubsetup" — refus quand même, message différent.
    assert.ok(interaction._replies[0]?.content.includes("pas accès"), JSON.stringify(interaction._replies));
  });

  await cas("un accès à une AUTRE rubrique ne suffit pas pour server.voice.manage précisément", async () => {
    const guild = makeGuild("g-panel3b");
    const roleId = "role-logs-only";
    permStore.setRoleGrants(guild.id, roleId, ["logs.view"]);
    const membreAvecAutreDroit = { id: "membre-logs", guild, roles: { cache: new Collection([[roleId, { id: roleId }]]) } };
    const interaction = fakeInteraction(guild, "cfg:voicehubsetup", { member: membreAvecAutreDroit });
    await configPanel.handleConfigInteraction(interaction);
    assert.strictEqual(guild._created.length, 0);
    assert.ok(interaction._replies[0]?.content.includes("Accès refusé"), JSON.stringify(interaction._replies));
  });

  await cas("\"Modifier les noms\" ouvre une modale pré-remplie avec la valeur actuelle (un seul champ)", async () => {
    const guild = makeGuild("g-panel4");
    voiceChannels.setNameTemplates("g-panel4", { voiceNameTemplate: "Vocal-{pseudo}" });
    let capturedModal = null;
    const interaction = fakeInteraction(guild, "cfg:voicenames", { showModal: async (modal) => (capturedModal = modal) });
    await configPanel.handleConfigInteraction(interaction);
    const rows = capturedModal.toJSON().components;
    assert.strictEqual(rows.length, 1, "un seul champ maintenant que le salon texte compagnon n'existe plus");
    assert.strictEqual(rows[0].components[0].value, "Vocal-{pseudo}");
  });

  await cas("la soumission de la modale enregistre le nouveau modèle", async () => {
    const guild = makeGuild("g-panel5");
    const interaction = fakeInteraction(guild, "cfg:voicenames", {
      isModalSubmit: () => true,
      fields: { getTextInputValue: () => "🎙️ {pseudo}" },
    });
    await configPanel.handleConfigInteraction(interaction);
    assert.strictEqual(voiceChannels.getHubConfig("g-panel5").voiceNameTemplate, "🎙️ {pseudo}");
  });

  await cas("le sélecteur de salon-panneau enregistre bien le choix", async () => {
    const guild = makeGuild("g-panel6");
    const interaction = fakeInteraction(guild, "cfg:voicepanelchannel", { values: ["chan-panel-x"] });
    await configPanel.handleConfigInteraction(interaction);
    assert.strictEqual(voiceChannels.getHubConfig("g-panel6").panelChannelId, "chan-panel-x");
  });

  await cas("la rubrique Vocaux du panel s'affiche sans erreur, config vide ou remplie", () => {
    const guildVide = makeGuild("g-render-vide");
    const guildPleine = makeGuild("g-render-pleine");
    voiceChannels.setSpawnCategory("g-render-pleine", "cat-x");
    voiceChannels.setPanelChannel("g-render-pleine", "panel-x");
    for (const g of [guildVide, guildPleine]) {
      const panel = configPanel.buildConfigPanel(g, "voice", makeMember(g));
      for (const c of panel.components) c.toJSON();
    }
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
