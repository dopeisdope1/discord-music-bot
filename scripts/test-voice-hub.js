/**
 * Vérifie le panneau de contrôle PARTAGÉ des salons vocaux temporaires
 * (&panel > Communauté > Vocaux > "Créer la configuration") :
 *  - un seul salon-panneau permanent, jamais un salon compagnon créé puis
 *    détruit à chaque salon vocal ;
 *  - ses boutons agissent sur le salon vocal où la personne qui CLIQUE est
 *    connectée à cet instant, pas sur le salon où le clic a eu lieu ;
 *  - le chat du vocal reçoit un message d'accueil qui MENTIONNE réellement
 *    le propriétaire, avec un seul bouton "Gérer ton salon" qui ouvre les
 *    vrais contrôles en ÉPHÉMÈRE (jamais de bouton-lien : ne navigue pas de
 *    façon fiable depuis le chat d'un salon vocal, confirmé en réel) ;
 *  - le salon-panneau n'est visible QUE par qui possède actuellement un
 *    salon temporaire (setPanelAccess), accordé/retiré à la création, la
 *    suppression et le transfert d'un salon.
 *
 * Lancement : node scripts/test-voice-hub.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "voicehub-test-"));
process.env.BOT_OWNER_IDS = "owner-bot";

const { Collection, ChannelType } = require("discord.js");
const voiceChannels = require("../utils/voiceChannels");
const { buildVoiceControlCard, buildVoiceWelcomeCard, handleVoiceControlInteraction, setPanelAccess } = require("../utils/serverAdminCommands");

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

const PROPRIO = "proprietaire-1";
const VOCAL = "vocal-1";
const PANEL = "panel-contrôle-1";
const GUILD_ID = "g1";

const contenu = (payload) => payload.components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content).join("\n");

(async () => {
  console.log("Carte de contrôle : STATIQUE, un seul exemplaire :");

  await cas("se construit sans paramètre, sans erreur", () => {
    const carte = buildVoiceControlCard();
    for (const c of carte.components) c.toJSON();
    const texte = contenu(carte);
    assert.ok(texte.includes("où tu es connecté au moment du clic"), texte);
    const boutons = carte.components[0].toJSON().components.filter((c) => c.type === 1).flatMap((r) => r.components.map((b) => b.custom_id));
    for (const attendu of ["vcpanel:lock", "vcpanel:unlock", "vcpanel:rename", "vcpanel:add", "vcpanel:remove", "vcpanel:transfer", "vcpanel:kick"]) {
      assert.ok(boutons.includes(attendu), `${attendu} manque`);
    }
  });

  await cas("ne mentionne personne (aucun propriétaire connu à l'avance)", () => {
    assert.deepStrictEqual(buildVoiceControlCard().allowedMentions, { parse: [] });
  });

  await cas('"lock" est bien étiqueté FERMER et "unlock" bien étiqueté OUVRIR (pas l\'inverse)', () => {
    // Bug réel signalé : les deux libellés étaient inversés — cliquer
    // "Ouvrir" verrouillait le salon et "Fermer" le déverrouillait.
    const boutons = buildVoiceControlCard()
      .components[0].toJSON()
      .components.filter((c) => c.type === 1)
      .flatMap((r) => r.components);
    assert.strictEqual(boutons.find((b) => b.custom_id === "vcpanel:lock").label, "Fermer");
    assert.strictEqual(boutons.find((b) => b.custom_id === "vcpanel:unlock").label, "Ouvrir");
  });

  console.log("\nAccueil du salon vocal :");

  await cas("mentionne réellement le propriétaire", () => {
    const carte = buildVoiceWelcomeCard({ id: VOCAL, guildId: GUILD_ID, name: "Salon de uo" }, PROPRIO);
    assert.ok(contenu(carte).includes(`<@${PROPRIO}>`), "la mention doit être dans le texte");
    // Le client Discord.js du bot désactive toutes les mentions par défaut
    // (index.js) : sans cet override, le ping n'en serait pas un.
    assert.deepStrictEqual(carte.allowedMentions, { users: [PROPRIO] });
  });

  await cas('"Gérer ton salon" ouvre les contrôles en ÉPHÉMÈRE — jamais de bouton-lien', () => {
    // Confirmé en conditions réelles (mobile) : un bouton-lien cliqué depuis
    // le chat propre à un salon vocal ne navigue pas de façon fiable, la
    // personne reste bloquée sur le message — limitation du client Discord,
    // aucune alternative de lien n'y changerait rien.
    const carte = buildVoiceWelcomeCard({ id: VOCAL, guildId: GUILD_ID, name: "x" }, PROPRIO);
    const boutons = carte.components[0].toJSON().components.filter((c) => c.type === 1).flatMap((r) => r.components);
    assert.ok(!boutons.some((b) => b.style === 5), "aucun bouton-lien ne doit plus être présent"); // ButtonStyle.Link
    assert.deepStrictEqual(boutons.map((b) => b.custom_id), ["vcpanel:menu"]);
  });

  console.log("\nLes boutons agissent sur le salon vocal COURANT de la personne qui clique :");

  const HUB = "hub-non-enregistre";

  const interactionConnecteA = (voiceChannelId, membreId, clickChannel) => {
    const reponses = [];
    return {
      customId: "vcpanel:lock",
      channel: clickChannel,
      user: { id: membreId, tag: "membre#0001" },
      member: { id: membreId, voice: { channelId: voiceChannelId } },
      guild: {
        id: GUILD_ID,
        roles: { everyone: { id: GUILD_ID } },
        channels: {
          cache: new Collection([
            [VOCAL, { id: VOCAL, type: ChannelType.GuildVoice, name: "Salon de uo", permissionOverwrites: { edit: async () => {} } }],
            // Le générateur lui-même : un VRAI salon vocal, jamais enregistré
            // comme salon temporaire (voiceChannels.registerChannel n'est
            // jamais appelé dessus).
            [HUB, { id: HUB, type: ChannelType.GuildVoice, name: "➕ Nouveau salon vocal", permissionOverwrites: { edit: async () => {} } }],
          ]),
        },
      },
      isModalSubmit: () => false,
      reply: async (p) => {
        reponses.push(p);
        return {};
      },
      _reponses: reponses,
    };
  };

  voiceChannels.registerChannel(VOCAL, GUILD_ID, PROPRIO);

  await cas("le propriétaire connecté à SON salon peut le verrouiller, peu importe où il clique", async () => {
    const salonPanel = { id: PANEL, type: ChannelType.GuildText };
    const interaction = interactionConnecteA(VOCAL, PROPRIO, salonPanel);
    await handleVoiceControlInteraction(interaction);
    assert.strictEqual(interaction._reponses[0]?.content, "Salon verrouillé.");
  });

  await cas("quelqu'un connecté à un AUTRE salon (pas le sien) est refusé", async () => {
    const salonPanel = { id: PANEL, type: ChannelType.GuildText };
    const interaction = interactionConnecteA(VOCAL, "intrus", salonPanel);
    await handleVoiceControlInteraction(interaction);
    assert.ok(interaction._reponses[0]?.content.includes("propriétaire"), JSON.stringify(interaction._reponses));
  });

  await cas("pas connecté du tout à un salon vocal -> message clair, pas de plantage", async () => {
    const salonPanel = { id: PANEL, type: ChannelType.GuildText };
    const interaction = interactionConnecteA(null, PROPRIO, salonPanel);
    await handleVoiceControlInteraction(interaction);
    assert.ok(interaction._reponses[0]?.content.includes("Rejoins"), JSON.stringify(interaction._reponses));
  });

  await cas("le salon où le clic a eu lieu n'a AUCUNE importance (même le vocal lui-même)", async () => {
    const interaction = interactionConnecteA(VOCAL, PROPRIO, { id: VOCAL, type: ChannelType.GuildVoice });
    await handleVoiceControlInteraction(interaction);
    assert.strictEqual(interaction._reponses[0]?.content, "Salon verrouillé.");
  });

  await cas("connecté à un salon vocal RÉEL mais jamais enregistré (le générateur lui-même) -> refusé, MÊME pour le propriétaire du bot", async () => {
    // Bug réel signalé : le rang owner/sys passait outre canManageVoiceChannel
    // sans vérifier que le salon était bien un salon temporaire enregistré —
    // le propriétaire du bot pouvait "gérer" n'importe quel salon vocal où
    // il se trouvait connecté, générateur y compris, juste en cliquant
    // depuis le panneau partagé.
    const salonPanel = { id: PANEL, type: ChannelType.GuildText };
    const interaction = interactionConnecteA(HUB, "owner-bot", salonPanel);
    await handleVoiceControlInteraction(interaction);
    assert.ok(interaction._reponses[0]?.content.includes("Rejoins"), JSON.stringify(interaction._reponses));
  });

  await cas("connecté à un salon RÉELLEMENT enregistré mais dont il n'est PAS propriétaire -> refusé, MÊME pour le propriétaire du bot", async () => {
    // Second correctif demandé sur le même sujet : owner/sys ne doit plus
    // avoir AUCUNE exception, y compris sur un vrai salon temporaire créé
    // par quelqu'un d'autre — plus de bypass du tout, ni ici ni dans &voc.
    const salonPanel = { id: PANEL, type: ChannelType.GuildText };
    const interaction = interactionConnecteA(VOCAL, "owner-bot", salonPanel);
    await handleVoiceControlInteraction(interaction);
    assert.ok(interaction._reponses[0]?.content.includes("propriétaire"), JSON.stringify(interaction._reponses));
  });

  await cas('le bouton "Gérer ton salon" (action "menu") ouvre les vrais contrôles en éphémère', async () => {
    const salonPanel = { id: PANEL, type: ChannelType.GuildText };
    const interaction = interactionConnecteA(VOCAL, PROPRIO, salonPanel);
    interaction.customId = "vcpanel:menu";
    await handleVoiceControlInteraction(interaction);
    const payload = interaction._reponses[0];
    assert.ok((payload.flags & 64) === 64, "doit être éphémère"); // MessageFlags.Ephemeral
    const boutons = payload.components[0].toJSON().components.filter((c) => c.type === 1).flatMap((r) => r.components.map((b) => b.custom_id));
    for (const attendu of ["vcpanel:lock", "vcpanel:unlock", "vcpanel:rename", "vcpanel:kick"]) {
      assert.ok(boutons.includes(attendu), `${attendu} manque`);
    }
  });

  console.log("\nAccès au salon-panneau (utils/serverAdminCommands.js::setPanelAccess) :");

  function makeGuildWithPanel(panelId) {
    const overwrites = new Map();
    const panelChannel = {
      id: panelId,
      permissionOverwrites: {
        edit: async (target, perms) => overwrites.set(target.id || target, { ...(overwrites.get(target.id || target) || {}), ...perms }),
        delete: async (target) => overwrites.delete(target.id || target),
      },
    };
    voiceChannels.setPanelChannel("g-acl", panelId);
    return {
      id: "g-acl",
      roles: { everyone: { id: "g-acl" } },
      channels: { cache: new Collection([[panelId, panelChannel]]) },
      _overwrites: overwrites,
    };
  }

  await cas("accorder l'accès donne bien ViewChannel:true à cette personne précise", async () => {
    const guild = makeGuildWithPanel("panel-acl-1");
    await setPanelAccess(guild, "membre-1", true);
    assert.strictEqual(guild._overwrites.get("membre-1").ViewChannel, true);
  });

  await cas("retirer l'accès supprime l'overwrite de cette personne", async () => {
    const guild = makeGuildWithPanel("panel-acl-2");
    await setPanelAccess(guild, "membre-1", true);
    await setPanelAccess(guild, "membre-1", false);
    assert.ok(!guild._overwrites.has("membre-1"));
  });

  await cas("@everyone est mis à ViewChannel:false à chaque appel (corrige aussi un ancien salon-panneau public)", async () => {
    const guild = makeGuildWithPanel("panel-acl-3");
    await setPanelAccess(guild, "membre-1", true);
    assert.strictEqual(guild._overwrites.get("g-acl").ViewChannel, false);
  });

  await cas("sans salon-panneau configuré, ne plante pas (no-op silencieux)", async () => {
    const guild = { id: "g-sans-panel", roles: { everyone: { id: "g-sans-panel" } }, channels: { cache: new Collection() } };
    await setPanelAccess(guild, "membre-1", true); // ne doit pas lever
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
