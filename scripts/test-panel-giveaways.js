/**
 * Vérifie la rubrique Giveaways de la famille Communauté (module 6 de la
 * refonte du panel) : &giveaway existait déjà en commande mais n'avait aucune
 * rubrique panel. "Démarrer" ouvre la carte de formulaire EXISTANTE
 * (utils/commandForms.js::FORMS.giveaway_start, celle que &giveaway ouvre
 * déjà bare) ; "Terminer"/"Reroll" appellent directement utils/giveaways.js —
 * jamais un second tirage au sort réimplémenté pour le panel.
 *
 * Lancement : node scripts/test-panel-giveaways.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "panel-giveaways-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { Collection, PermissionsBitField } = require("discord.js");
const { buildConfigPanel, buildSectionSpec, handleConfigInteraction, ID } = require("../utils/configPanel");
const giveawayStore = require("../utils/giveawayStore");
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

const MESSAGE_ID = "555555555555555555";
const CHANNEL_ID = "chan-giveaway";

function makeChannel() {
  return {
    id: CHANNEL_ID,
    // Un vrai salon a un nom : la rubrique est dessinée, et c'est ce nom qui
    // s'affiche à la place de `<#id>` (utils/sectionDashboard.js).
    name: "concours",
    isTextBased: () => true,
    messages: { fetch: async () => null },
    send: async () => ({}),
  };
}

function makeGuild(channel) {
  return {
    id: "ggive",
    name: "Serveur",
    ownerId: "owner-1",
    memberCount: 0,
    roles: { cache: new Collection(), everyone: { permissions: new PermissionsBitField([]) } },
    channels: { cache: new Collection([[CHANNEL_ID, channel]]) },
    members: { cache: new Collection(), me: { roles: { highest: { position: 9 } } } },
    emojis: { cache: new Collection() },
    voiceStates: { cache: new Collection() },
    // utils/giveaways.js::finishGiveaway lit client.channels.cache
    // directement (pas guild.channels), d'où ce doublon délibéré.
    client: { uptime: 1, ws: { ping: 1 }, guilds: { cache: new Collection() }, channels: { cache: new Collection([[CHANNEL_ID, channel]]) } },
  };
}

function mkMember(id, roleId) {
  return {
    id,
    guild: { id: "ggive", ownerId: "owner-1" },
    roles: { cache: roleId ? new Collection([[roleId, { id: roleId }]]) : new Collection() },
    permissions: { has: () => false },
  };
}

/**
 * Le corps de la rubrique est DESSINÉ (tableau de bord) : son contenu se lit
 * sur la spec passée au moteur de rendu, pas sur les composants texte, qui ne
 * portent plus que l'en-tête.
 */
function texteDessine(guild, member, state) {
  const spec = buildSectionSpec(guild, "giveaways", member, state);
  const morceaux = [spec.titre, spec.pied || ""];
  for (const carte of spec.cartes) {
    morceaux.push(carte.titre || "", carte.vide || "");
    for (const item of carte.items) morceaux.push(item.nom, item.description || "");
  }
  return morceaux.join("\n");
}

function render(guild, member, state) {
  const json = buildConfigPanel(guild, "giveaways", member, state).components[0].toJSON();
  return {
    texte: [...json.components.filter((c) => c.type === 10).map((c) => c.content), texteDessine(guild, member, state)].join("\n"),
    boutons: json.components.filter((c) => c.type === 1).flatMap((r) => r.components),
  };
}

(async () => {
  console.log("Communauté — Giveaways :");

  const channel = makeChannel();
  const guild = makeGuild(channel);

  giveawayStore.create({
    messageId: MESSAGE_ID,
    guildId: "ggive",
    channelId: CHANNEL_ID,
    prize: "Nitro",
    endsAt: Date.now() + 3600_000,
    hostId: "owner-1",
    winnersCount: 1,
    requiredRoleId: null,
  });

  await cas("sans server.giveaways.manage, la rubrique n'est pas proposée", () => {
    const noAccess = mkMember("u-none");
    const json = buildConfigPanel(guild, "giveaways", noAccess).components[0].toJSON();
    const titre = json.components.find((c) => c.type === 10).content;
    assert.ok(!titre.includes("Giveaways"), titre);
  });

  permStore.setRoleGrants("ggive", "role-give", ["server.giveaways.manage"]);
  const member = mkMember("u-give", "role-give");

  await cas("le giveaway en cours (Nitro) apparaît avec son salon et son nombre de participants", () => {
    const { texte } = render(guild, member, {});
    assert.ok(texte.includes("Nitro"), texte);
    // Le salon apparaît par son NOM : une mention brute dessinée sur l'image
    // afficherait « <#chan-giveaway> », illisible.
    assert.ok(texte.includes("#concours"), texte);
    assert.ok(!texte.includes(`<#${CHANNEL_ID}>`), `aucune mention brute ne doit rester : ${texte}`);
    assert.ok(texte.includes("0 participant"), texte);
  });

  await cas('"Démarrer un giveaway" ouvre la VRAIE carte de formulaire (FORMS.giveaway_start), pas un nouvel écran', async () => {
    let replied = null;
    await handleConfigInteraction({
      customId: `${ID}:giveawaystart`,
      member,
      guild,
      reply: async (p) => {
        replied = p;
      },
    });
    const texte = replied.components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content).join("\n");
    assert.ok(texte.includes("Lancer un giveaway"), texte);
  });

  await cas("choisir un giveaway dans le menu révèle les boutons Terminer/Reroll", async () => {
    let panel = null;
    await handleConfigInteraction({
      customId: `${ID}:giveawaypick`,
      values: [MESSAGE_ID],
      member,
      guild,
      update: async (p) => {
        panel = p;
      },
    });
    // Les actions sont désormais les options d'un menu déroulant unique
    // (`cfg:action`), plus des boutons alignés.
    const composants = panel.components[0].toJSON().components.filter((c) => c.type === 1).flatMap((r) => r.components);
    const labels = [
      ...composants.map((b) => b.label),
      ...composants.filter((c) => c.custom_id === `${ID}:action`).flatMap((m) => m.options.map((o) => o.label)),
    ].filter(Boolean);
    assert.ok(labels.includes("Terminer maintenant"), labels.join(", "));
    assert.ok(labels.includes("Retirer un gagnant (reroll)"), labels.join(", "));
  });

  await cas('"Terminer maintenant" termine RÉELLEMENT le giveaway (utils/giveaways.js::endGiveaway, pas une réimplémentation)', async () => {
    let updated = null;
    await handleConfigInteraction({
      customId: `${ID}:giveawayend:${MESSAGE_ID}`,
      member,
      guild,
      client: guild.client,
      update: async (p) => {
        updated = p;
      },
      followUp: async () => ({}),
    });
    assert.ok(updated, "le panel doit rester sur la rubrique Giveaways");
    assert.strictEqual(giveawayStore.get(MESSAGE_ID).ended, true, "le VRAI store doit refléter la fin du giveaway");
  });

  await cas("avec un accès panel mais sans server.giveaways.manage, actionner directement giveawaystart reste refusé", async () => {
    permStore.setRoleGrants("ggive", "role-other", ["logs.view"]);
    const otherAccess = mkMember("u-other", "role-other");
    let refused = null;
    await handleConfigInteraction({
      customId: `${ID}:giveawaystart`,
      member: otherAccess,
      guild,
      reply: async (p) => {
        refused = p;
      },
    });
    assert.ok(refused?.content?.includes("pas la permission"), JSON.stringify(refused));
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
