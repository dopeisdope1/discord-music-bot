/**
 * Vérifie le REPLI TEXTE du tableau de bord de &panel (&help est en texte
 * pur depuis son passage en liste par palier de permission, il n'a donc plus
 * rien à replier).
 *
 * &panel est une IMAGE et rien d'autre sur ses rubriques : le message ne
 * contient qu'un MediaGallery pointant sur la pièce jointe
 * (utils/dashboardImage.js). Deux choses peuvent donc le faire disparaître
 * entièrement, alors que tout son contenu existe déjà en texte dans la spec :
 *
 *  - le DESSIN échoue (mémoire, police, spec inattendue) — le VPS est petit ;
 *  - l'ENVOI est refusé par Discord, typiquement quand le bot n'a pas la
 *    permission « Joindre des fichiers » dans le salon.
 *
 * Dans les deux cas, l'utilisateur ne voyait qu'un « Une erreur est survenue »
 * — ou, sur un clic de navigation, un « Échec de l'interaction ». Même
 * principe que les cartes de sanction (utils/actionCard.js) : ce qui compte
 * n'est pas le rendu, c'est que la commande reste utilisable sans lui.
 *
 * Lancement : node scripts/test-dashboard-fallback.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "dashfallback-test-"));
// Le membre de test est propriétaire : &panel exige hasAnyPanelAccess, sinon
// la commande sort en silence et le test ne vérifierait rien.
process.env.BOT_OWNER_IDS = "testeur";

const { Collection, PermissionsBitField, ChannelType } = require("discord.js");
const { rendreEnCache, enTexte } = require("../utils/dashboardImage");
const { buildConfigPanel, handleConfigInteraction, ID: ID_PANEL } = require("../utils/configPanel");
const { handleMusicTextCommand } = require("../utils/musicCommands");

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

const estPNG = (buf) => Buffer.isBuffer(buf) && buf.subarray(1, 4).toString() === "PNG";

// Types de composants Discord, tels qu'ils ressortent de toJSON().
const TEXTE = 10;
const RANGEE = 1;
const GALERIE = 12;

const composantsDe = (payload) => payload.components[0].toJSON().components;
const texteDe = (payload) =>
  composantsDe(payload)
    .filter((c) => c.type === TEXTE)
    .map((c) => c.content)
    .join("\n");

const SPEC_VALIDE = {
  titre: "Centre de commandes",
  sousTitre: "uo067 · Préfixe : &",
  cartes: [{ titre: "Modération", couleur: "#ff6b6b", items: [{ nom: "&kick", description: "expulse un membre" }] }],
  pied: "Tape une commande pour commencer",
};

const membre = {
  id: "testeur",
  guild: { id: "g1" },
  roles: { cache: new Collection() },
  permissions: { has: () => true },
  displayName: "uo067",
};

function makeGuild() {
  const everyone = { id: "g1", name: "@everyone", permissions: new PermissionsBitField([]) };
  return {
    id: "g1",
    name: "Serveur",
    ownerId: "quelquun-dautre",
    memberCount: 3,
    roles: { cache: new Collection([["g1", everyone]]), everyone },
    channels: { cache: new Collection() },
    members: { cache: new Collection(), me: { roles: { highest: { position: 10 } } } },
    emojis: { cache: new Collection() },
    voiceStates: { cache: new Collection() },
    client: { uptime: 987654, ws: { ping: 17 }, guilds: { cache: new Collection() } },
  };
}

/**
 * Un message texte comme le dispatcher en reçoit un. `refuseFichiers` simule
 * le salon où le bot n'a pas « Joindre des fichiers » : Discord rejette alors
 * le message dès qu'il porte une pièce jointe, et seulement dans ce cas.
 */
function fakeMessage(contenu, { refuseFichiers = false } = {}) {
  const guild = makeGuild();
  const envois = [];
  const utilisateur = { id: "testeur", tag: "testeur#0001", bot: false, username: "uo067" };
  const message = {
    content: `&${contenu}`,
    author: utilisateur,
    member: { ...membre, guild, user: utilisateur },
    guild,
    channel: {
      id: "c1",
      type: ChannelType.GuildText,
      permissionsFor: () => new PermissionsBitField(PermissionsBitField.All),
      send: async (payload) => {
        envois.push(payload);
        return {};
      },
    },
    envois,
    reply: async (payload) => {
      envois.push(payload);
      if (refuseFichiers && payload.files?.length) {
        throw new Error("Missing Permissions"); // ce que renvoie l'API Discord
      }
      return {};
    },
  };
  return message;
}

(async () => {
  console.log("Rendu du tableau de bord — un dessin raté ne supprime pas la commande :");

  await cas("une spec valide donne toujours une vraie image (pas de régression)", () => {
    assert.ok(estPNG(rendreEnCache(SPEC_VALIDE)));
  });

  await cas("un rendu impossible renvoie null au lieu de jeter — l'appelant peut retomber en texte", () => {
    // `titre` absent : le moteur appelle .toUpperCase() dessus et lève.
    const png = rendreEnCache({ sousTitre: "x", cartes: [{ titre: "A", couleur: "#fff", items: [] }] });
    assert.strictEqual(png, null);
  });

  await cas("un échec n'est PAS mis en cache — la tentative suivante redessine", () => {
    const specCassee = { titre: null, cartes: [] };
    assert.strictEqual(rendreEnCache(specCassee), null);
    assert.strictEqual(rendreEnCache(specCassee), null);
  });

  console.log("\nVersion texte de la même spec :");

  await cas("le texte reprend le titre, les cartes et les commandes réellement dessinés", () => {
    const texte = enTexte(SPEC_VALIDE);
    assert.ok(texte.includes("CENTRE DE COMMANDES"), texte);
    assert.ok(texte.includes("Modération"), texte);
    assert.ok(texte.includes("&kick"), texte);
    assert.ok(texte.includes("expulse un membre"), texte);
  });

  await cas("une carte vide affiche son propre message, pas une section muette", () => {
    const texte = enTexte({ titre: "T", cartes: [{ titre: "Vide", items: [], vide: "Aucune commande accessible" }] });
    assert.ok(texte.includes("Aucune commande accessible"), texte);
  });

  await cas("le texte ne dépasse jamais le plafond Discord (4000 caractères cumulés) et annonce la coupe", () => {
    const enorme = {
      titre: "Trop grand",
      cartes: Array.from({ length: 40 }, (_, i) => ({
        titre: `Catégorie ${i}`,
        items: Array.from({ length: 20 }, (_, j) => ({ nom: `&commande-${i}-${j}`, description: "une description assez longue pour peser" })),
      })),
    };
    const texte = enTexte(enorme);
    assert.ok(texte.length < 4000, `${texte.length} caractères`);
    assert.ok(texte.includes("Liste raccourcie"), "une liste tronquée doit le dire, sinon elle passe pour complète");
  });

  await cas("une spec cassée ne fait pas échouer le repli à son tour — c'est justement son rôle", () => {
    assert.doesNotThrow(() => enTexte(undefined));
    assert.doesNotThrow(() => enTexte({ cartes: [{ items: null }] }));
  });

  console.log("\n&panel sans image :");

  await cas("l'accueil n'a plus d'image du tout — une RUBRIQUE, si", () => {
    // L'accueil listait les 23 rubriques que le menu affiche déjà : l'image
    // était interminable et redondante. Les rubriques, elles, dessinent bien
    // leur contenu.
    assert.strictEqual(buildConfigPanel(makeGuild(), "home", membre).files, undefined);
    assert.strictEqual(buildConfigPanel(makeGuild(), "tickets", membre).files.length, 1);
  });

  await cas("sansImage : une rubrique repasse en texte, sans pièce jointe, navigation intacte", () => {
    const panel = buildConfigPanel(makeGuild(), "tickets", membre, {}, { sansImage: true });
    assert.strictEqual(panel.files, undefined);
    assert.ok(!composantsDe(panel).some((c) => c.type === GALERIE));
    assert.ok(composantsDe(panel).some((c) => c.type === RANGEE), "le menu de navigation doit rester utilisable");
    assert.ok(texteDe(panel).includes("Tickets"), texteDe(panel));
  });

  console.log("\nEnvoi refusé par Discord (pas de « Joindre des fichiers ») :");

  await cas("&panel n'a rien à replier : son accueil ne joint aucun fichier", async () => {
    // Le repli existe toujours pour les RUBRIQUES, qui portent une image ;
    // l'accueil, lui, n'en a plus, donc un salon qui refuse les pièces
    // jointes ne change rien pour lui.
    const message = fakeMessage("panel", { refuseFichiers: true });
    await handleMusicTextCommand(message.client, message);
    assert.strictEqual(message.envois.length, 1, "un seul envoi, sans seconde tentative");
    assert.strictEqual(message.envois[0].files, undefined);
  });

  await cas("&help n'a rien à replier non plus : texte pur, jamais de pièce jointe", async () => {
    const message = fakeMessage("help", { refuseFichiers: true });
    await handleMusicTextCommand(message.client, message);
    assert.ok(message.envois.length >= 1, "au moins un envoi");
    for (const envoi of message.envois) assert.strictEqual(envoi.files, undefined, "aucun envoi ne doit joindre de fichier");
  });

  console.log("\nNavigation refusée (le message est édité, pas recréé) :");

  /**
   * Une interaction dont `update` refuse tout payload portant une pièce
   * jointe — le même salon sans « Joindre des fichiers », mais sur un clic
   * de navigation : là, un échec laisse « Échec de l'interaction » et le
   * panneau figé sur l'écran précédent.
   */
  function fakeClic(customId, valeur) {
    const guild = makeGuild();
    const editions = [];
    return {
      guild,
      guildId: guild.id,
      member: { ...membre, guild },
      user: { id: "testeur" },
      customId,
      values: valeur ? [valeur] : [],
      isModalSubmit: () => false,
      editions,
      reply: async () => {},
      update: async (payload) => {
        editions.push(payload);
        if (payload.files?.length) throw new Error("Missing Permissions");
        return payload;
      },
    };
  }

  await cas("&panel : le repli joue sur une RUBRIQUE, la seule à porter une image", async () => {
    // L'accueil n'a plus d'image : il n'y a rien à replier pour lui. Une
    // rubrique, si — et un salon qui refuse les pièces jointes doit toujours
    // pouvoir l'afficher en texte plutôt que de laisser le clic sans réponse.
    const clic = fakeClic(`${ID_PANEL}:nav:tickets`);
    await handleConfigInteraction(clic);
    assert.strictEqual(clic.editions.length, 2);
    assert.strictEqual(clic.editions[1].files, undefined);
    assert.deepStrictEqual(clic.editions[1].attachments, []);
  });

  await cas("&panel : l'accueil passe du premier coup — il ne joint plus rien", async () => {
    const clic = fakeClic(`${ID_PANEL}:nav:accueil`);
    await handleConfigInteraction(clic);
    assert.strictEqual(clic.editions.length, 1, "aucune seconde tentative nécessaire");
    assert.strictEqual(clic.editions[0].files, undefined);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué" : ", tout est vert"}.`);
})();
