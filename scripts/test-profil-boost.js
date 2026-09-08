/**
 * Vérifie &boost et &profil (utils/boostProgress.js, utils/profileCommands.js).
 *
 * CE QUI COMPTE LE PLUS ICI : tout ce qui est affiché doit venir de l'API.
 * La seule ancienneté qu'un bot peut connaître est `member.premiumSince`, la
 * date à laquelle la personne a commencé à booster CE serveur. Quand elle
 * manque, l'écran doit le DIRE — jamais inventer une progression, jamais
 * estimer une date.
 *
 * (Il n'y a volontairement pas de commande &nitro : la date d'activation du
 * Nitro n'existe sur aucun objet accessible à un bot.)
 *
 * Lancement : node scripts/test-profil-boost.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "profil-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { DateTime } = require("luxon");
const boostProgress = require("../utils/boostProgress");
const profileCard = require("../utils/profileCard");
const profileCommands = require("../utils/profileCommands");

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

const MAINTENANT = DateTime.fromISO("2026-09-08T08:30:00").toJSDate();
const DEBUT = DateTime.fromISO("2026-07-28T08:07:00").toJSDate();

const membre = (premiumSince) => ({
  id: "1518213370082230325",
  premiumSince,
  user: {
    id: "1518213370082230325",
    username: "ner",
    tag: "ner",
    createdAt: DateTime.fromISO("2026-06-21T11:17:00").toJSDate(),
    displayAvatarURL: () => "https://cdn.discordapp.com/avatars/1/x.png",
  },
  client: { guilds: { cache: new Map() } },
});

(async () => {
  console.log("La progression vient de la VRAIE date de boost :");

  await cas("l'ancienneté et le palier sont calculés depuis member.premiumSince", () => {
    const p = boostProgress.progression(DEBUT, MAINTENANT);
    // 28/07 -> 08/09 : un mois et onze jours.
    assert.strictEqual(p.moisEcoules, 1);
    assert.strictEqual(p.palierActuel, 1);
    assert.strictEqual(p.palierSuivant, 2);
    assert.strictEqual(p.debut.getTime(), DEBUT.getTime(), "la date de départ ne doit pas être retouchée");
  });

  await cas("les dates de paliers tombent aux ANNIVERSAIRES du boost, pas tous les 30 jours", () => {
    // Un mois calendaire n'a pas 30 jours : compter en jours décalerait toutes
    // les échéances de plusieurs jours au bout d'un an.
    const p = boostProgress.progression(DEBUT, MAINTENANT);
    const parMois = Object.fromEntries(p.paliers.map((x) => [x.mois, x.date]));
    assert.strictEqual(boostProgress.dateCourte(parMois[0]), "28/07/2026");
    assert.strictEqual(boostProgress.dateCourte(parMois[1]), "28/08/2026");
    assert.strictEqual(boostProgress.dateCourte(parMois[2]), "28/09/2026");
    assert.strictEqual(boostProgress.dateCourte(parMois[24]), "28/07/2028");
  });

  await cas("les paliers sont ceux de Discord — 0,1,2,3,6,9,12,15,18,24 — pas une suite inventée", () => {
    assert.deepStrictEqual(boostProgress.PALIERS, [0, 1, 2, 3, 6, 9, 12, 15, 18, 24]);
  });

  await cas("le pourcentage mesure le chemin ENTRE deux paliers, pas depuis le début", () => {
    // Mesuré depuis le début, la barre resterait quasi vide pendant deux ans,
    // le dernier palier étant à 24 mois.
    const p = boostProgress.progression(DEBUT, MAINTENANT);
    assert.ok(p.pourcentage > 25 && p.pourcentage < 50, `${p.pourcentage}% — 11 jours sur ~31`);
    // Juste après un palier : proche de 0. Juste avant le suivant : proche de 100.
    const justeApres = boostProgress.progression(DEBUT, DateTime.fromJSDate(DEBUT).plus({ months: 1, hours: 1 }).toJSDate());
    assert.ok(justeApres.pourcentage <= 2, `${justeApres.pourcentage}%`);
    const justeAvant = boostProgress.progression(DEBUT, DateTime.fromJSDate(DEBUT).plus({ months: 2 }).minus({ hours: 1 }).toJSDate());
    assert.ok(justeAvant.pourcentage >= 98, `${justeAvant.pourcentage}%`);
  });

  await cas("au dernier palier, plus de suivant et la barre est pleine", () => {
    const p = boostProgress.progression(DEBUT, DateTime.fromJSDate(DEBUT).plus({ months: 30 }).toJSDate());
    assert.strictEqual(p.palierActuel, 24);
    assert.strictEqual(p.palierSuivant, null);
    assert.strictEqual(p.dateSuivante, null);
    assert.strictEqual(p.pourcentage, 100);
  });

  await cas("une échéance lointaine se dit en MOIS — « dans 1 an » sous-estimait de dix mois", () => {
    // 22 mois d'échéance : Luxon tronquait à « dans 1 an », rendant les
    // paliers 15, 18 et 24 indistinguables sur l'écran.
    const dans22Mois = DateTime.fromJSDate(MAINTENANT).plus({ months: 22 }).toJSDate();
    assert.strictEqual(boostProgress.relatif(dans22Mois, MAINTENANT), "dans 22 mois");
    // En deçà d'un an, le vocabulaire naturel est conservé.
    assert.strictEqual(boostProgress.relatif(DateTime.fromJSDate(MAINTENANT).plus({ days: 19 }).toJSDate(), MAINTENANT), "dans 19 jours");
  });

  console.log("\nSans boost, l'écran le DIT — il n'invente rien :");

  await cas("aucun boost -> aucune progression, pas une progression à zéro", () => {
    assert.strictEqual(boostProgress.progression(null), null);
    assert.strictEqual(boostProgress.progression(undefined), null);
    const spec = profileCommands.specBoost(membre(null), MAINTENANT);
    assert.strictEqual(spec.progression, null);
  });

  await cas("la carte se dessine quand même, avec le motif écrit dessus", () => {
    const png = profileCard.dessinerBoost(profileCommands.specBoost(membre(null), MAINTENANT));
    assert.ok(Buffer.isBuffer(png) && png.subarray(1, 4).toString() === "PNG");
  });

  await cas("une date invalide ne produit pas une ancienneté négative ni un plantage", () => {
    assert.strictEqual(boostProgress.progression(new Date("pas une date")), null);
    // Horloge décalée : un boost « dans le futur » reste à zéro.
    const futur = boostProgress.progression(DateTime.fromJSDate(MAINTENANT).plus({ days: 3 }).toJSDate(), MAINTENANT);
    assert.strictEqual(futur.moisEcoules, 0);
    assert.ok(futur.joursEcoules >= 0, futur.joursEcoules);
  });

  console.log("\n&profil : que des données réellement disponibles");

  await cas("identifiant, pseudo et date de création viennent de l'objet User", () => {
    const spec = profileCommands.specProfil(membre(DEBUT), MAINTENANT);
    assert.strictEqual(spec.identifiant, "1518213370082230325");
    assert.strictEqual(spec.mention, "@ner");
    assert.ok(spec.creation.startsWith("21/06/2026"), spec.creation);
  });

  await cas("la mention est écrite « @pseudo », jamais « <@id> » — un canvas ne la résoudrait pas", () => {
    const spec = profileCommands.specProfil(membre(DEBUT), MAINTENANT);
    assert.ok(!/[<>]/.test(spec.mention), spec.mention);
  });

  await cas("les serveurs en commun sont ceux que le BOT partage, jamais tous ceux du membre", () => {
    // Le bot ne connaît pas les autres serveurs de la personne : prétendre les
    // lister serait inventer une donnée.
    const m = membre(DEBUT);
    m.client.guilds.cache = new Map([
      ["a", { name: "For You", members: { cache: new Map([[m.id, 1]]) } }],
      ["b", { name: "Osaka", members: { cache: new Map([[m.id, 1]]) } }],
      ["c", { name: "Sans lui", members: { cache: new Map() } }],
    ]);
    const spec = profileCommands.specProfil(m, MAINTENANT);
    assert.deepStrictEqual(spec.serveurs, ["For You", "Osaka"]);
  });

  await cas("les deux cartes produisent un vrai PNG, recadré sur leur contenu", () => {
    const boost = profileCard.dessinerBoost(profileCommands.specBoost(membre(DEBUT), MAINTENANT));
    const profil = profileCard.dessinerProfil(profileCommands.specProfil(membre(DEBUT), MAINTENANT));
    for (const png of [boost, profil]) {
      assert.ok(Buffer.isBuffer(png), "un Buffer PNG est attendu");
      assert.strictEqual(png.subarray(1, 4).toString(), "PNG");
    }
    // La carte &boost porte dix paliers : elle DOIT être plus haute que le
    // profil. C'est ce qui attrape un recadrage qui couperait l'historique.
    const hauteurDe = (png) => png.readUInt32BE(20);
    assert.ok(hauteurDe(boost) > hauteurDe(profil), `boost ${hauteurDe(boost)} vs profil ${hauteurDe(profil)}`);
    assert.ok(hauteurDe(boost) >= 900, `l'historique complet ne tient pas en ${hauteurDe(boost)}px`);
  });

  console.log("\nLa cible se donne par mention ou par identifiant :");

  await cas("sans argument, la cible est l'auteur", async () => {
    const m = membre(DEBUT);
    const message = { member: m, mentions: { members: { first: () => null } }, guild: { members: { fetch: async () => null } } };
    assert.strictEqual(await profileCommands.cibleDe(message, []), m);
  });

  await cas("un identifiant inconnu ne renvoie personne — la commande le dira", async () => {
    const message = {
      member: membre(DEBUT),
      mentions: { members: { first: () => null } },
      guild: { members: { fetch: async () => { throw new Error("Unknown Member"); } } },
    };
    assert.strictEqual(await profileCommands.cibleDe(message, ["123456789012345678"]), null);
    assert.strictEqual(await profileCommands.cibleDe(message, ["pas-un-id"]), null);
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
