/**
 * Vérifie les rubriques Sauvegardes et Profil du bot (module 10, dernier de
 * la refonte du panel) : toutes deux absentes de &panel jusqu'ici. Chaque
 * action réutilise TEL QUEL utils/serverBackup.js (&backup) et
 * utils/botProfileCommands.js — jamais une deuxième implémentation.
 * La restauration exige deux confirmations successives (amélioration
 * explicitement demandée pour le panel) : ce fichier vérifie qu'AUCUN salon
 * n'est créé après une seule confirmation, et que les VRAIS salons sont créés
 * seulement après la seconde.
 *
 * Lancement : node scripts/test-panel-backups-bot.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-backups-bot-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField, ChannelType } = require("discord.js");
const { buildConfigPanel, buildSectionSpec, handleConfigInteraction, ID } = require("../utils/configPanel");
const backupStore = require("../utils/serverBackupStore");
const botProfileStore = require("../utils/botProfileStore");
const { handleConfirmInteraction } = require("../utils/serverAdminCommands");

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

function makeGuild() {
  const createdChannels = [];
  const guild = {
    id: "gback",
    name: "Serveur",
    ownerId: "owner-1",
    memberCount: 0,
    roles: { cache: new Collection(), everyone: { permissions: new PermissionsBitField([]) } },
    channels: {
      cache: new Collection(),
      create: async ({ name, type }) => {
        const created = { id: `chan-${createdChannels.length + 1}`, name, type };
        createdChannels.push(created);
        return created;
      },
    },
    members: { cache: new Collection(), me: { roles: { highest: { position: 9 } } } },
    emojis: { cache: new Collection() },
    voiceStates: { cache: new Collection() },
    client: {
      uptime: 1,
      ws: { ping: 1 },
      guilds: { cache: new Collection() },
      user: {
        setUsername: async (name) => { guild.client.user._name = name; },
        setPresence: () => {},
      },
    },
    _createdChannels: createdChannels,
  };
  return guild;
}

const owner = { id: "owner-1", guild: { id: "gback", ownerId: "owner-1" }, roles: { cache: new Collection() }, permissions: { has: () => true } };
const noAccess = { id: "u-none", guild: { id: "gback", ownerId: "owner-1" }, roles: { cache: new Collection() }, permissions: { has: () => false } };

function titre(guild, section, member, state) {
  return buildConfigPanel(guild, section, member, state).components[0].toJSON().components.find((c) => c.type === 10).content;
}

/**
 * Les actions d'un écran sont désormais les options d'un menu déroulant
 * unique (`cfg:action`), plus des boutons alignés. On lit donc les deux :
 * les boutons restants (liens, qu'un menu ne sait pas porter) et les options.
 */
function libellesActions(json) {
  const composants = json.components.filter((c) => c.type === 1).flatMap((r) => r.components);
  return [
    ...composants.map((b) => b.label),
    ...composants.filter((c) => c.custom_id === `${ID}:action`).flatMap((m) => m.options.map((o) => o.label)),
  ].filter(Boolean);
}

(async () => {
  console.log("Sauvegardes et Profil du bot :");

  const guild = makeGuild();

  await cas("sans le rang sys, ni Sauvegardes ni Profil du bot ne sont proposés", () => {
    assert.ok(!titre(guild, "backups", noAccess).includes("Sauvegardes"));
    assert.ok(!titre(guild, "botProfile", noAccess).includes("Profil du bot"));
  });

  await cas('"Sauvegarder ce serveur" (modale) crée RÉELLEMENT une entrée dans le VRAI serverBackupStore', async () => {
    let modalShown = null;
    await handleConfigInteraction({
      customId: `${ID}:backupsavebtn`,
      member: owner,
      guild,
      isModalSubmit: () => false,
      showModal: async (m) => { modalShown = m; },
    });
    assert.ok(modalShown, "une modale aurait dû s'ouvrir");

    let replied = null;
    await handleConfigInteraction({
      customId: `${ID}:backupsavebtn`,
      member: owner,
      guild,
      isModalSubmit: () => true,
      fields: { getTextInputValue: () => "MaSauvegarde" },
      reply: async (p) => { replied = p; },
    });
    assert.ok(backupStore.getBackup("MaSauvegarde"), "la sauvegarde doit exister dans le VRAI store");
    assert.ok(replied, "backup() doit avoir répondu directement via l'interaction");
  });

  await cas("la rubrique liste bien cette sauvegarde après création", () => {
    // serverBackupStore stocke les noms en minuscules (voir getBackup/saveBackup).
    // Le corps de la rubrique est DESSINÉ : son contenu se lit sur la spec
    // passée au moteur de rendu (utils/configPanel.js::buildSectionSpec).
    const spec = buildSectionSpec(guild, "backups", owner);
    const texte = spec.cartes
      .flatMap((c) => [c.titre || "", c.vide || "", ...c.items.map((i) => `${i.nom} ${i.description || ""}`)])
      .join("\n");
    assert.ok(texte.includes("masauvegarde"), texte);
  });

  await cas("choisir un préréglage intégré (yunara) ne propose PAS de bouton Supprimer", () => {
    const json = buildConfigPanel(guild, "backups", owner, { backupSelected: "yunara" }).components[0].toJSON();
    const labels = libellesActions(json);
    assert.ok(labels.some((l) => l.includes("Restaurer")), labels.join(", "));
    assert.ok(!labels.includes("Supprimer"), labels.join(", "));
  });

  await cas("choisir une sauvegarde enregistrée propose Restaurer ET Supprimer", () => {
    const json = buildConfigPanel(guild, "backups", owner, { backupSelected: "masauvegarde" }).components[0].toJSON();
    const labels = libellesActions(json);
    assert.ok(labels.includes("Supprimer"), labels.join(", "));
  });

  await cas("restaurer une sauvegarde EXIGE deux confirmations successives — aucun salon créé après une seule", async () => {
    backupStore.saveBackup("Struct", {
      sourceGuildName: "Source",
      createdAt: new Date().toISOString(),
      categories: [{ name: "Cat1", channels: [{ name: "chan1", type: ChannelType.GuildText }] }],
      uncategorized: [],
    });

    let firstCard = null;
    await handleConfigInteraction({
      customId: `${ID}:backuprestore:Struct`,
      member: owner,
      guild,
      user: { id: "owner-1" },
      reply: async (p) => { firstCard = p; },
    });
    assert.ok(firstCard, "la première carte de confirmation aurait dû être postée");

    // Extrait le token du bouton "Restaurer" de la première carte (srv:confirm:go:TOKEN).
    const firstButtons = firstCard.components[0].toJSON().components.filter((c) => c.type === 1).flatMap((r) => r.components);
    const goButton1 = firstButtons.find((b) => b.style === 4); // ButtonStyle.Danger
    assert.ok(goButton1, "bouton de confirmation introuvable sur la première carte");

    let secondCard = null;
    await handleConfirmInteraction({
      customId: goButton1.custom_id,
      user: { id: "owner-1" },
      member: owner,
      guild,
      reply: async (p) => { secondCard = p; },
    });
    assert.ok(secondCard, "une SECONDE carte de confirmation aurait dû être postée");
    assert.strictEqual(guild._createdChannels.length, 0, "aucun salon ne doit être créé après une seule confirmation");

    const secondButtons = secondCard.components[0].toJSON().components.filter((c) => c.type === 1).flatMap((r) => r.components);
    const goButton2 = secondButtons.find((b) => b.style === 4);
    assert.ok(goButton2, "bouton de confirmation introuvable sur la seconde carte");

    let finalResult = null;
    await handleConfirmInteraction({
      customId: goButton2.custom_id,
      user: { id: "owner-1" },
      member: owner,
      guild,
      update: async (p) => { finalResult = p; },
    });
    assert.ok(finalResult, "un résultat final aurait dû être affiché");
    assert.strictEqual(guild._createdChannels.length, 2, "1 catégorie + 1 salon = 2 créations, seulement après la SECONDE confirmation");
  });

  await cas('changer le statut du bot (menu) appelle RÉELLEMENT botProfileCommands.js, pas une copie', async () => {
    botProfileStore.setStatus("online");
    await handleConfigInteraction({
      customId: `${ID}:botstatus`,
      values: ["idle"],
      member: owner,
      guild,
      client: guild.client,
      user: { id: "owner-1" },
      reply: async () => {},
    });
    assert.strictEqual(botProfileStore.getConfig().status, "idle", "le VRAI store doit refléter le changement");
  });

  await cas('"Changer le nom" (modale) appelle RÉELLEMENT client.user.setUsername', async () => {
    let modalShown = null;
    await handleConfigInteraction({
      customId: `${ID}:botnamebtn`,
      member: owner,
      guild,
      isModalSubmit: () => false,
      showModal: async (m) => { modalShown = m; },
    });
    assert.ok(modalShown);

    let replied = null;
    await handleConfigInteraction({
      customId: `${ID}:botnamebtn`,
      member: owner,
      guild,
      client: guild.client,
      user: { id: "owner-1" },
      isModalSubmit: () => true,
      fields: { getTextInputValue: () => "NouveauNom" },
      reply: async (p) => { replied = p; },
    });
    assert.strictEqual(guild.client.user._name, "NouveauNom");
    assert.ok(replied);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
