/**
 * Commandes personnalisées : &addcmd / &delcmd / &listcmd, et le rappel du
 * texte enregistré quand on tape son nom (utils/customCommandStore.js,
 * utils/customCommands.js).
 *
 * DEUX RISQUES portent tout ce fichier, parce qu'ils touchent au reste du bot :
 *
 *   1. MASQUER UNE VRAIE COMMANDE. Si `ban` pouvait être enregistrée comme
 *      commande personnalisée, `&ban` cesserait de bannir — une panne de
 *      modération silencieuse, impossible à diagnostiquer. Deux barrières
 *      indépendantes : le nom est refusé à la création, ET le routeur ne
 *      consulte les commandes personnalisées qu'en dernier recours.
 *
 *   2. MENTION DE MASSE. Une réponse est du texte libre republié par le BOT.
 *      Un `@everyone` dedans deviendrait une notification générale envoyée
 *      avec les permissions du bot, déclenchable ensuite par n'importe qui.
 *
 * Lancement : node scripts/test-commandes-personnalisees.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cmdperso-test-"));
process.env.BOT_OWNER_IDS = "staff-1";

const { Collection } = require("discord.js");
const store = require("../utils/customCommandStore");
const { customCommandHandlers, repondreSiPersonnalisee, SANS_MENTIONS } = require("../utils/customCommands");
const { MOD_COMMAND_NAMES } = require("../utils/musicCommands");

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

const GUILD = "g1";
const staff = { id: "staff-1", guild: { id: GUILD, ownerId: "staff-1" }, roles: { cache: new Collection() }, permissions: { has: () => true } };
// Un membre ordinaire : aucun droit, aucun rôle.
const simple = { id: "membre-1", guild: { id: GUILD, ownerId: "staff-1" }, roles: { cache: new Collection() }, permissions: { has: () => false } };

/** Faux message : capture ce qui aurait été envoyé. */
function message(contenu = "", membre = staff) {
  const envoyes = [];
  return {
    envoyes,
    author: { id: membre.id },
    member: membre,
    guild: { id: GUILD },
    content: contenu,
    reply: async (payload) => {
      envoyes.push(payload);
      return payload;
    },
  };
}

const texteDe = (payload) =>
  payload.content || (payload.embeds || []).map((e) => (e.toJSON ? e.toJSON() : e)).map((e) => `${e.title || ""} ${e.description || ""}`).join("\n");

(async () => {
  console.log("Créer, rappeler, supprimer :");

  await cas("une commande créée répond ensuite quand on tape son nom", async () => {
    const m = message();
    await customCommandHandlers.addcmd(null, m, ["regles", "Lis", "le", "salon", "#reglement"]);
    assert.ok(/créée/i.test(texteDe(m.envoyes[0])), texteDe(m.envoyes[0]));

    const rappel = message();
    assert.strictEqual(await repondreSiPersonnalisee(rappel, "regles"), true);
    assert.strictEqual(rappel.envoyes[0].content, "Lis le salon #reglement");
  });

  await cas("un mot inconnu ne déclenche RIEN — le préfixe est partagé avec le CrowBot", async () => {
    const m = message();
    assert.strictEqual(await repondreSiPersonnalisee(m, "nexistepas"), false);
    assert.strictEqual(m.envoyes.length, 0, "aucune réponse ne doit partir");
  });

  await cas("le compteur d'utilisations suit les rappels réels", async () => {
    const avant = store.get(GUILD, "regles").utilisations;
    await repondreSiPersonnalisee(message(), "regles");
    assert.strictEqual(store.get(GUILD, "regles").utilisations, avant + 1);
  });

  await cas("recréer le même nom remplace la réponse sans perdre le compteur", async () => {
    const utilisations = store.get(GUILD, "regles").utilisations;
    await customCommandHandlers.addcmd(null, message(), ["regles", "Nouveau", "texte"]);
    assert.strictEqual(store.get(GUILD, "regles").texte, "Nouveau texte");
    assert.strictEqual(store.get(GUILD, "regles").utilisations, utilisations, "le compteur ne doit pas repartir de zéro");
  });

  await cas("supprimer une commande la rend inerte", async () => {
    await customCommandHandlers.delcmd(null, message(), ["regles"]);
    assert.strictEqual(store.get(GUILD, "regles"), null);
    assert.strictEqual(await repondreSiPersonnalisee(message(), "regles"), false);
  });

  await cas("un membre sans le droit ne peut ni créer ni supprimer", async () => {
    store.set(GUILD, "protegee", "texte", "staff-1", []);
    const creation = message("", simple);
    await customCommandHandlers.addcmd(null, creation, ["squat", "texte"]);
    assert.strictEqual(store.get(GUILD, "squat"), null, "la commande n'aurait pas dû être créée");

    const suppression = message("", simple);
    await customCommandHandlers.delcmd(null, suppression, ["protegee"]);
    assert.ok(store.get(GUILD, "protegee"), "la commande n'aurait pas dû être supprimée");
  });

  await cas("mais tout le monde peut LISTER — savoir quoi taper n'est pas un pouvoir", async () => {
    const m = message("", simple);
    await customCommandHandlers.listcmd(null, m);
    assert.ok(m.envoyes.length, "la liste doit s'afficher même sans droit");
  });

  console.log("\nImpossible de masquer une vraie commande du bot :");

  await cas("`ban` est refusé — sinon &ban cesserait de bannir, sans le moindre signal", () => {
    const resultat = store.set(GUILD, "ban", "coucou", "staff-1", MOD_COMMAND_NAMES);
    assert.strictEqual(resultat.ok, false);
    assert.ok(/commande du bot/.test(resultat.motif), resultat.motif);
    assert.strictEqual(store.get(GUILD, "ban"), null);
  });

  await cas("AUCUNE commande réelle ne peut être enregistrée, pas seulement `ban`", () => {
    // Balayage complet plutôt qu'un échantillon : c'est la garantie qui doit
    // survivre à l'ajout de nouvelles commandes.
    const acceptes = MOD_COMMAND_NAMES.filter((nom) => store.set(GUILD, nom, "x", "staff-1", MOD_COMMAND_NAMES).ok);
    assert.deepStrictEqual(acceptes, [], `noms acceptés à tort : ${acceptes.join(", ")}`);
  });

  await cas("le routeur ne consulte les personnalisées qu'en DERNIER — seconde barrière", () => {
    // Même si un nom réservé se retrouvait un jour dans le fichier (édité à
    // la main, importé d'ailleurs), la vraie commande garderait la priorité.
    const source = fs.readFileSync(path.join(__dirname, "..", "utils", "musicCommands.js"), "utf8");
    const posHandler = source.indexOf("const handler = modHandlers[cmdLower]");
    const posPerso = source.indexOf("repondreSiPersonnalisee");
    assert.ok(posHandler > 0 && posPerso > posHandler, "les commandes personnalisées doivent être consultées APRÈS les vraies");
  });

  console.log("\nUne réponse ne peut pas servir de mégaphone :");

  await cas("les mentions sont désactivées à l'envoi", async () => {
    await customCommandHandlers.addcmd(null, message(), ["annonce", "salut", "@everyone", "<@&123>"]);
    const m = message();
    await repondreSiPersonnalisee(m, "annonce");
    // Le texte est conservé tel quel — c'est la NOTIFICATION qui est coupée.
    assert.ok(m.envoyes[0].content.includes("@everyone"), m.envoyes[0].content);
    assert.deepStrictEqual(m.envoyes[0].allowedMentions, SANS_MENTIONS);
    assert.deepStrictEqual(SANS_MENTIONS.parse, [], "aucune catégorie de mention ne doit être autorisée");
  });

  console.log("\nBornes et validation :");

  await cas("un nom à caractères exotiques est refusé", () => {
    for (const mauvais of ["mon nom", "règles!", "a".repeat(40), ""]) {
      assert.strictEqual(store.set(GUILD, mauvais, "x", "staff-1", []).ok, false, `"${mauvais}" aurait dû être refusé`);
    }
  });

  await cas("une réponse vide ou démesurée est refusée", () => {
    assert.strictEqual(store.set(GUILD, "vide", "   ", "staff-1", []).ok, false);
    assert.strictEqual(store.set(GUILD, "trop", "x".repeat(store.MAX_LONGUEUR_REPONSE + 1), "staff-1", []).ok, false);
  });

  await cas("le nombre par serveur est borné — le fichier est relu en entier au démarrage", () => {
    let cree = 0;
    for (let i = 0; i < store.MAX_PAR_SERVEUR + 10; i++) {
      if (store.set("g-plein", `cmd${i}`, "texte", "staff-1", []).ok) cree++;
    }
    assert.strictEqual(cree, store.MAX_PAR_SERVEUR);
    assert.strictEqual(store.count("g-plein"), store.MAX_PAR_SERVEUR);
  });

  await cas("les serveurs sont cloisonnés", () => {
    store.set("g-a", "salut", "bonjour de A", "staff-1", []);
    assert.strictEqual(store.get("g-b", "salut"), null);
  });

  await cas("le nom est insensible à la casse et au préfixe collé devant", async () => {
    store.set(GUILD, "faq", "réponse", "staff-1", []);
    assert.ok(store.get(GUILD, "FAQ"), "la casse ne doit pas compter");
    assert.ok(store.get(GUILD, "&faq"), "un préfixe collé devant ne doit pas empêcher de retrouver la commande");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
