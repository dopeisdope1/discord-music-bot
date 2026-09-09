/**
 * Quota sur les commandes qui DESSINENT une image
 * (utils/musicCommands.js).
 *
 * `&help` et `&panel` rendent une image à chaque appel. Elles sont
 * accessibles sans droit particulier, et le VPS n'a que 458 Mo : quelqu'un
 * qui les enchaîne en boucle mobilise la machine pour rien. Le cache amortit
 * les rendus IDENTIQUES, pas ceux qui changent de page à chaque fois.
 *
 * CE QUE CE FICHIER PROTÈGE SURTOUT : que le quota ne déborde pas sur les
 * commandes de modération. Bannir dix personnes d'affilée est un usage
 * légitime, et se faire refuser au huitième serait bien pire que le coût du
 * dessin.
 *
 * Lancement : node scripts/test-limite-dessin.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "limite-test-"));
process.env.BOT_OWNER_IDS = "owner-1";
process.env.MUSIC_ENABLED = "false";

const { Collection } = require("discord.js");
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

const client = { user: { id: "bot" }, guilds: { cache: new Collection() } };

/** Un message de commande, d'une personne donnée. */
function message(contenu, auteurId) {
  const reponses = [];
  const membre = {
    id: auteurId,
    guild: { id: "g1", ownerId: "owner-1" },
    displayName: auteurId,
    roles: { cache: new Collection() },
    permissions: { has: () => true },
    voice: { channel: null },
  };
  return {
    reponses,
    content: contenu,
    author: { id: auteurId, bot: false, tag: `${auteurId}#0001` },
    member: membre,
    guildId: "g1",
    guild: {
      id: "g1",
      name: "test",
      ownerId: "owner-1",
      memberCount: 3,
      roles: { cache: new Collection() },
      channels: { cache: new Collection() },
      members: { cache: new Collection(), me: { roles: { highest: { position: 9 } } }, fetch: async () => null },
      emojis: { cache: new Collection() },
      voiceStates: { cache: new Collection() },
      client,
    },
    channel: { id: "c1", send: async () => ({}) },
    mentions: { members: { first: () => null }, roles: { first: () => null }, users: new Collection(), channels: new Collection() },
    attachments: { first: () => null },
    reply: async (payload) => {
      reponses.push(payload);
      return { id: `r${reponses.length}` };
    },
  };
}

/** Le texte d'une réponse, quel que soit son format. */
const texteDe = (payload) =>
  payload?.content ||
  (payload?.embeds || []).map((e) => (e.toJSON ? e.toJSON() : e)).map((e) => e.description || "").join(" ") ||
  "";

(async () => {
  console.log("Les commandes qui dessinent sont bornées :");

  await cas("`&help` en boucle finit par être refusé, avec un message clair", async () => {
    let refus = null;
    for (let i = 0; i < 12; i++) {
      const m = message("&help", "spammeur");
      await handleMusicTextCommand(client, m);
      const dernier = m.reponses.at(-1);
      if (dernier && /Doucement/.test(texteDe(dernier))) {
        refus = texteDe(dernier);
        break;
      }
    }
    assert.ok(refus, "le quota devait finir par s'appliquer");
    // Le refus doit DIRE combien de temps attendre : un « non » sans délai
    // laisse la personne réessayer au hasard.
    assert.ok(/\d+ seconde/.test(refus), `le délai doit être indiqué : ${refus}`);
  });

  await cas("le quota est PAR PERSONNE — le spam de l'un ne bloque pas l'autre", async () => {
    // Sinon une seule personne pourrait rendre `&help` inutilisable pour tout
    // le serveur, ce qui serait un déni de service offert sur un plateau.
    for (let i = 0; i < 12; i++) await handleMusicTextCommand(client, message("&help", "spammeur-2"));

    const innocent = message("&help", "quelquun-dautre");
    await handleMusicTextCommand(client, innocent);
    const dernier = innocent.reponses.at(-1);
    assert.ok(!/Doucement/.test(texteDe(dernier || {})), "une autre personne ne doit pas être pénalisée");
  });

  console.log("\nLa modération n'est PAS bridée :");

  await cas("les commandes de modération ne sont pas dans la liste des commandes limitées", () => {
    // Vérifié sur la source : la liste est une constante, et l'y voir figurer
    // une commande de sanction serait invisible autrement jusqu'au jour où
    // quelqu'un se ferait refuser un bannissement en urgence.
    const code = fs.readFileSync(path.join(__dirname, "..", "utils", "musicCommands.js"), "utf8");
    const ligne = /const COMMANDES_DESSINEES = new Set\(\[([^\]]*)\]\)/.exec(code);
    assert.ok(ligne, "la liste doit exister");
    const limitees = ligne[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
    assert.deepStrictEqual(limitees.sort(), ["help", "panel"], `liste inattendue : ${limitees.join(", ")}`);
    for (const sanction of ["ban", "kick", "mute", "warn", "clear", "timeout"]) {
      assert.ok(!limitees.includes(sanction), `${sanction} ne doit JAMAIS être limitée`);
    }
  });

  await cas("le quota reste généreux — un usage normal ne le voit jamais", () => {
    const code = fs.readFileSync(path.join(__dirname, "..", "utils", "musicCommands.js"), "utf8");
    const ligne = /createRateLimiter\((\d+), (\d+)_?(\d*)\)/.exec(code.slice(code.indexOf("limiteurDessin")));
    assert.ok(ligne, "le limiteur doit être configuré");
    assert.ok(Number(ligne[1]) >= 5, `${ligne[1]} appels : trop serré pour un usage normal`);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
