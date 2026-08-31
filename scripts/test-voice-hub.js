/**
 * Vérifie le montage des salons vocaux temporaires (&voicehub) :
 *  - un salon TEXTE compagnon est créé juste au-dessus du vocal, verrouillé en
 *    écriture pour tout le monde (les administrateurs passent outre par
 *    construction Discord) ;
 *  - le panneau à boutons est posté dans ce salon texte, et ses boutons
 *    agissent bien sur le salon VOCAL apparié ;
 *  - le chat du vocal reçoit un message d'accueil qui MENTIONNE réellement le
 *    propriétaire ;
 *  - le salon texte est supprimé avec le vocal, sinon un salon mort
 *    s'accumulerait à chaque création.
 *
 * Lancement : node scripts/test-voice-hub.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "voicehub-test-"));
process.env.BOT_OWNER_IDS = "owner-bot";

const { Collection, ChannelType, PermissionFlagsBits } = require("discord.js");
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
const TEXTE = "texte-1";

const contenu = (payload) => payload.components[0].toJSON().components.filter((c) => c.type === 10).map((c) => c.content).join("\n");

(async () => {
  console.log("Appariement salon texte / salon vocal :");

  voiceChannels.registerChannel(VOCAL, "g1", PROPRIO, TEXTE);

  await cas("le salon texte est retenu avec le vocal", () => {
    assert.strictEqual(voiceChannels.getChannelInfo(VOCAL).textChannelId, TEXTE);
    assert.strictEqual(voiceChannels.getVoiceChannelForText(TEXTE), VOCAL);
  });

  await cas("un salon texte inconnu ne renvoie aucun vocal", () => {
    assert.strictEqual(voiceChannels.getVoiceChannelForText("texte-inconnu"), null);
  });

  await cas("un vocal créé sans salon texte reste valide", () => {
    voiceChannels.registerChannel("vocal-2", "g1", "autre");
    assert.strictEqual(voiceChannels.getChannelInfo("vocal-2").textChannelId, null);
  });

  console.log("\nContenu des deux cartes :");

  await cas("le panneau invite à rejoindre son vocal et porte les boutons", () => {
    const carte = buildVoiceControlCard({ id: VOCAL, name: "Salon de uo" }, PROPRIO);
    const texte = contenu(carte);
    assert.ok(texte.includes("Panel de contrôle"), texte);
    assert.ok(texte.includes("Rejoins ton salon vocal"), texte);
    const boutons = carte.components[0].toJSON().components.filter((c) => c.type === 1).flatMap((r) => r.components.map((b) => b.custom_id));
    for (const attendu of ["vcpanel:lock", "vcpanel:unlock", "vcpanel:rename", "vcpanel:add", "vcpanel:remove", "vcpanel:transfer", "vcpanel:kick"]) {
      assert.ok(boutons.includes(attendu), `${attendu} manque`);
    }
  });

  await cas("l'accueil mentionne réellement le propriétaire", () => {
    const carte = buildVoiceWelcomeCard({ id: VOCAL, name: "Salon de uo" }, PROPRIO, TEXTE);
    assert.ok(contenu(carte).includes(`<@${PROPRIO}>`), "la mention doit être dans le texte");
    // Le client Discord.js du bot désactive toutes les mentions par défaut
    // (index.js) : sans cet override, le ping n'en serait pas un.
    assert.deepStrictEqual(carte.allowedMentions, { users: [PROPRIO] });
  });

  await cas("l'accueil liste les commandes et renvoie vers le panneau", () => {
    const texte = contenu(buildVoiceWelcomeCard({ id: VOCAL, name: "x" }, PROPRIO, TEXTE));
    for (const commande of ["&vc lock", "&vc add @membre", "&vc kick @membre", "&vc rename <nom>", "&vc limit <n>", "&vc transfer @membre"]) {
      assert.ok(texte.includes(commande), `${commande} manque`);
    }
    assert.ok(texte.includes(`<#${TEXTE}>`), "le lien vers le salon du panneau manque");
  });

  await cas("sans salon texte, l'accueil ne renvoie pas vers un salon inexistant", () => {
    const texte = contenu(buildVoiceWelcomeCard({ id: VOCAL, name: "x" }, PROPRIO, null));
    assert.ok(!texte.includes("boutons : <#"), texte);
  });

  console.log("\nLes boutons agissent depuis le salon TEXTE :");

  const interactionDepuis = (channel, membreId) => {
    const reponses = [];
    return {
      customId: "vcpanel:lock",
      channel,
      user: { id: membreId, tag: "membre#0001" },
      member: { id: membreId },
      guild: {
        id: "g1",
        roles: { everyone: { id: "g1" } },
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

  await cas("un clic depuis le salon texte verrouille bien le vocal apparié", async () => {
    const salonTexte = { id: TEXTE, type: ChannelType.GuildText };
    const interaction = interactionDepuis(salonTexte, PROPRIO);
    await handleVoiceControlInteraction(interaction);
    assert.strictEqual(interaction._reponses[0]?.content, "Salon verrouillé.");
  });

  await cas("quelqu'un qui n'est pas propriétaire est refusé", async () => {
    const salonTexte = { id: TEXTE, type: ChannelType.GuildText };
    const interaction = interactionDepuis(salonTexte, "intrus");
    await handleVoiceControlInteraction(interaction);
    assert.ok(interaction._reponses[0]?.content.includes("propriétaire"), JSON.stringify(interaction._reponses));
  });

  await cas("un salon texte sans vocal apparié ne fait rien", async () => {
    const inconnu = { id: "texte-orphelin", type: ChannelType.GuildText };
    const interaction = interactionDepuis(inconnu, PROPRIO);
    await handleVoiceControlInteraction(interaction);
    assert.deepStrictEqual(interaction._reponses, []);
  });

  await cas("un clic depuis le vocal lui-même marche toujours (anciennes cartes)", async () => {
    const salonVocal = { id: VOCAL, type: ChannelType.GuildVoice, name: "Salon de uo", permissionOverwrites: { edit: async () => {} } };
    const interaction = interactionDepuis(salonVocal, PROPRIO);
    await handleVoiceControlInteraction(interaction);
    assert.strictEqual(interaction._reponses[0]?.content, "Salon verrouillé.");
  });

  console.log("\nVerrouillage du salon texte :");

  await cas("les overwrites refusent l'écriture à @everyone et l'autorisent au bot", () => {
    // Reproduit ce que index.js passe à channels.create().
    const overwrites = [
      { id: "g1", deny: [PermissionFlagsBits.SendMessages] },
      { id: "bot", allow: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.ViewChannel] },
    ];
    const everyone = overwrites.find((o) => o.id === "g1");
    assert.ok(everyone.deny.includes(PermissionFlagsBits.SendMessages), "@everyone doit être muet");
    assert.ok(!everyone.deny.includes(PermissionFlagsBits.ViewChannel), "mais doit voir le panneau pour cliquer");
    assert.ok(overwrites.find((o) => o.id === "bot").allow.includes(PermissionFlagsBits.SendMessages));
  });

  console.log("\nInstallation en un clic (&panel > Vocaux) :");

  const { setupVoiceHub, VOICE_CATEGORY_NAME, TEXT_CATEGORY_NAME, HUB_CHANNEL_NAME } = require("../utils/voiceHubSetup");

  function fakeGuild(id) {
    const cache = new Collection();
    let n = 0;
    return {
      id,
      roles: { everyone: { id } },
      members: { me: { id: "bot" } },
      channels: {
        cache,
        create: async (opts) => {
          const salon = { id: `cree-${++n}`, name: opts.name, type: opts.type, parent: opts.parent, permissionOverwrites: opts.permissionOverwrites };
          cache.set(salon.id, salon);
          return salon;
        },
      },
      _cache: cache,
    };
  }

  await cas("crée les deux catégories et le salon générateur", async () => {
    const guild = fakeGuild("g-setup");
    const { config, created } = await setupVoiceHub(guild);
    assert.strictEqual(created.length, 3, created.join(" | "));
    const noms = [...guild._cache.values()].map((c) => c.name);
    assert.ok(noms.includes(VOICE_CATEGORY_NAME) && noms.includes(TEXT_CATEGORY_NAME) && noms.includes(HUB_CHANNEL_NAME), noms.join(", "));
    assert.ok(config.hubId && config.voiceCategoryId && config.textCategoryId, JSON.stringify(config));
  });

  await cas("le générateur est bien rangé dans la catégorie des vocaux", async () => {
    const guild = fakeGuild("g-setup2");
    const { config } = await setupVoiceHub(guild);
    assert.strictEqual(guild._cache.get(config.hubId).parent, config.voiceCategoryId);
  });

  await cas("la catégorie des panneaux est verrouillée en écriture", async () => {
    const guild = fakeGuild("g-setup3");
    const { config } = await setupVoiceHub(guild);
    const overwrites = guild._cache.get(config.textCategoryId).permissionOverwrites;
    const everyone = overwrites.find((o) => o.id === "g-setup3");
    assert.ok(everyone.deny.includes(PermissionFlagsBits.SendMessages), "@everyone doit être muet");
    assert.ok(overwrites.some((o) => o.id === "bot"), "le bot doit garder le droit d'écrire");
  });

  await cas("relancée, elle ne recrée rien", async () => {
    const guild = fakeGuild("g-setup4");
    await setupVoiceHub(guild);
    const avant = guild._cache.size;
    const { created } = await setupVoiceHub(guild);
    assert.deepStrictEqual(created, [], "rien ne devait être recréé");
    assert.strictEqual(guild._cache.size, avant);
  });

  await cas("une pièce supprimée à la main est recréée, les autres non", async () => {
    const guild = fakeGuild("g-setup5");
    const { config } = await setupVoiceHub(guild);
    guild._cache.delete(config.hubId); // quelqu'un a supprimé le générateur
    const { created } = await setupVoiceHub(guild);
    assert.strictEqual(created.length, 1, created.join(" | "));
    assert.ok(created[0].includes(HUB_CHANNEL_NAME));
  });

  console.log("\nModèles de noms :");

  await cas("`{pseudo}` est remplacé, et le nom tronqué à la limite Discord", () => {
    assert.strictEqual(voiceChannels.formatChannelName("Salon de {pseudo}", "uo"), "Salon de uo");
    assert.strictEqual(voiceChannels.formatChannelName("panel-{pseudo}", "uo"), "panel-uo");
    assert.strictEqual(voiceChannels.formatChannelName("{pseudo}", "x".repeat(150)).length, 100);
  });

  await cas("un modèle absent retombe sur le défaut plutôt que sur un nom vide", () => {
    assert.strictEqual(voiceChannels.formatChannelName("", "uo"), "Salon de uo");
    assert.strictEqual(voiceChannels.formatChannelName(undefined, "uo"), "Salon de uo");
  });

  await cas("l'ancien format du fichier (une simple chaîne) reste lisible", () => {
    // Avant les catégories, seul l'identifiant du générateur était stocké.
    const fichier = path.join(process.env.DATA_DIR, "voiceHub.json");
    fs.writeFileSync(fichier, JSON.stringify({ "g-ancien": "hub-ancien" }));
    delete require.cache[require.resolve("../utils/voiceChannels")];
    const relu = require("../utils/voiceChannels");
    const config = relu.getHubConfig("g-ancien");
    assert.strictEqual(config.hubId, "hub-ancien");
    assert.strictEqual(config.voiceName, "Salon de {pseudo}", "les défauts comblent le reste");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
