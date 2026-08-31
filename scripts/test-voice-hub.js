/**
 * Vérifie le panneau de contrôle PARTAGÉ des salons vocaux temporaires
 * (&panel > Communauté > Vocaux > "Créer la configuration") :
 *  - un seul salon-panneau permanent, jamais un salon compagnon créé puis
 *    détruit à chaque salon vocal ;
 *  - ses boutons agissent sur le salon vocal où la personne qui CLIQUE est
 *    connectée à cet instant, pas sur le salon où le clic a eu lieu ;
 *  - le chat du vocal reçoit un message d'accueil qui MENTIONNE réellement
 *    le propriétaire, avec un bouton-lien vers le salon-panneau.
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
const { buildVoiceControlCard, buildVoiceWelcomeCard, handleVoiceControlInteraction } = require("../utils/serverAdminCommands");

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
    assert.ok(texte.includes("Rejoins ton salon vocal"), texte);
    const boutons = carte.components[0].toJSON().components.filter((c) => c.type === 1).flatMap((r) => r.components.map((b) => b.custom_id));
    for (const attendu of ["vcpanel:lock", "vcpanel:unlock", "vcpanel:rename", "vcpanel:add", "vcpanel:remove", "vcpanel:transfer", "vcpanel:kick"]) {
      assert.ok(boutons.includes(attendu), `${attendu} manque`);
    }
  });

  await cas("ne mentionne personne (aucun propriétaire connu à l'avance)", () => {
    assert.deepStrictEqual(buildVoiceControlCard().allowedMentions, { parse: [] });
  });

  console.log("\nAccueil du salon vocal :");

  await cas("mentionne réellement le propriétaire", () => {
    const carte = buildVoiceWelcomeCard({ id: VOCAL, guildId: GUILD_ID, name: "Salon de uo" }, PROPRIO, PANEL);
    assert.ok(contenu(carte).includes(`<@${PROPRIO}>`), "la mention doit être dans le texte");
    // Le client Discord.js du bot désactive toutes les mentions par défaut
    // (index.js) : sans cet override, le ping n'en serait pas un.
    assert.deepStrictEqual(carte.allowedMentions, { users: [PROPRIO] });
  });

  await cas("liste les commandes texte équivalentes", () => {
    const texte = contenu(buildVoiceWelcomeCard({ id: VOCAL, guildId: GUILD_ID, name: "x" }, PROPRIO, PANEL));
    for (const commande of ["&vc lock", "&vc add @membre", "&vc kick @membre", "&vc rename <nom>", "&vc limit <n>", "&vc transfer @membre"]) {
      assert.ok(texte.includes(commande), `${commande} manque`);
    }
  });

  await cas("porte un bouton-LIEN vers le salon-panneau (impossible de \"sauter\" de salon autrement)", () => {
    const carte = buildVoiceWelcomeCard({ id: VOCAL, guildId: GUILD_ID, name: "x" }, PROPRIO, PANEL);
    const boutons = carte.components[0].toJSON().components.filter((c) => c.type === 1).flatMap((r) => r.components);
    const lien = boutons.find((b) => b.style === 5); // ButtonStyle.Link
    assert.ok(lien, "aucun bouton-lien trouvé");
    assert.strictEqual(lien.url, `https://discord.com/channels/${GUILD_ID}/${PANEL}`);
  });

  await cas("sans salon-panneau configuré, pas de bouton du tout", () => {
    const carte = buildVoiceWelcomeCard({ id: VOCAL, guildId: GUILD_ID, name: "x" }, PROPRIO, null);
    const boutons = carte.components[0].toJSON().components.filter((c) => c.type === 1);
    assert.strictEqual(boutons.length, 0, JSON.stringify(boutons));
  });

  console.log("\nLes boutons agissent sur le salon vocal COURANT de la personne qui clique :");

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

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
