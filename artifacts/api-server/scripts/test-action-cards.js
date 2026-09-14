/**
 * Vérifie les cartes d'action en image (utils/actionCard.js) : la
 * confirmation d'un rôle donné ou d'une sanction est une IMAGE (avatar du
 * membre, action, rôle/raison/durée, modérateur), dans le même monde visuel
 * que le tableau de bord de &help et &panel.
 *
 * Le point qui compte le plus ici n'est pas le rendu mais le REPLI : la carte
 * est dessinée APRÈS que l'action a été appliquée. Si le CDN Discord ne
 * répond pas, ou si le rendu échoue, la commande doit quand même confirmer —
 * jamais rester muette, ce qui laisserait croire que la sanction a échoué.
 *
 * Lancement : node scripts/test-action-cards.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "actioncard-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { rendreCarteAction, carteActionMessage, carteSanctionMessage, avatarDe, nomDe, SANCTIONS } = require("../utils/actionCard");

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

/** Un membre comme discord.js en fournit un, sans toucher au réseau. */
function membre(id, tag, { avatar = true } = {}) {
  return {
    id,
    user: { tag, username: tag.split("#")[0] },
    displayAvatarURL: avatar ? () => "https://cdn.discordapp.com/embed/avatars/1.png" : undefined,
  };
}

(async () => {
  console.log("Carte d'action — rendu :");

  await cas("une carte de rôle est un vrai PNG", async () => {
    const png = await rendreCarteAction({
      titre: "Rôle ajouté",
      couleur: "#4ade80",
      membre: { nom: "uo067", sousTitre: "1210211587143766088" },
      lignes: [{ label: "Rôle", valeur: "Modérateur", couleur: "#5865f2" }],
    });
    assert.ok(estPNG(png), "l'en-tête PNG doit être valide");
  });

  await cas("une couleur mal formée ne fait pas planter le rendu (l'action a déjà eu lieu)", async () => {
    // "#fff" + suffixe d'opacité donnait "#fff26", refusé par le moteur.
    for (const couleur of ["#fff", "rouge", "", null, "#12345"]) {
      const png = await rendreCarteAction({ titre: "Test", couleur, membre: { nom: "Zoe" }, lignes: [] });
      assert.ok(estPNG(png), `couleur "${couleur}" : le rendu doit aboutir malgré tout`);
    }
  });

  await cas("une ligne sans valeur est omise, pas dessinée vide", async () => {
    const avec = await rendreCarteAction({
      titre: "Test",
      couleur: "#4ade80",
      membre: { nom: "Zoe" },
      lignes: [{ label: "Raison", valeur: "spam" }, { label: "Durée", valeur: null }, { label: "Par", valeur: undefined }],
    });
    const seule = await rendreCarteAction({
      titre: "Test",
      couleur: "#4ade80",
      membre: { nom: "Zoe" },
      lignes: [{ label: "Raison", valeur: "spam" }],
    });
    assert.strictEqual(avec.length, seule.length, "les lignes vides ne doivent rien ajouter à l'image");
  });

  await cas("un avatar injoignable ne fait pas échouer la carte — elle tombe sur les initiales", async () => {
    const png = await rendreCarteAction({
      titre: "Membre banni",
      couleur: "#ff6b6b",
      membre: { nom: "Trollus", avatarURL: "https://cdn.discordapp.com/ce-chemin-nexiste-pas/0.png" },
      lignes: [{ label: "Par", valeur: "uo067" }],
    });
    assert.ok(estPNG(png), "la carte doit être produite même sans photo");
  });

  await cas("un CDN qui ne répond pas ne bloque PAS la commande — la carte sort quand même", async () => {
    // Le pire scénario, et le plus discret : sans délai maximum sur le
    // téléchargement de l'avatar, la promesse reste en suspens pour toujours.
    // La commande n'affiche alors rien du tout — ni carte, ni repli texte, ni
    // erreur dans les logs — alors que la sanction a bien été appliquée.
    // 10.255.255.1 est une adresse privée non routée : la connexion pend.
    const debut = Date.now();
    const png = await rendreCarteAction({
      titre: "Membre banni",
      couleur: "#ff6b6b",
      membre: { nom: "Zoe", avatarURL: "https://10.255.255.1/avatar.png" },
      lignes: [{ label: "Par", valeur: "uo067" }],
    });
    const duree = Date.now() - debut;
    assert.ok(estPNG(png), "la carte doit être produite malgré le CDN injoignable");
    assert.ok(duree < 8000, `${duree} ms — le rendu doit abandonner l'avatar, pas attendre indéfiniment`);
  });

  console.log("\nLecture d'un membre, quelle que soit la forme reçue :");

  await cas("le nom est lu sur un GuildMember comme sur un User ou un objet partiel", () => {
    assert.strictEqual(nomDe(membre("1", "uo067#0001")), "uo067#0001");
    assert.strictEqual(nomDe({ tag: "direct#0002" }), "direct#0002");
    assert.strictEqual(nomDe({ username: "sansTag" }), "sansTag");
    assert.strictEqual(nomDe({ id: "42" }), "42");
    assert.strictEqual(nomDe(null), "inconnu");
  });

  await cas("l'avatar est absent sans planter quand l'objet ne sait pas le fournir", () => {
    // C'est le cas des fiches reconstruites depuis l'historique, et de tous
    // les objets de test : supposer la présence de displayAvatarURL faisait
    // planter &addrole.
    assert.strictEqual(avatarDe(membre("1", "a#1", { avatar: false })), undefined);
    assert.strictEqual(avatarDe({}), undefined);
    assert.strictEqual(avatarDe(null), undefined);
    assert.ok(avatarDe(membre("1", "a#1")).startsWith("https://"));
  });

  console.log("\nCartes de sanction :");

  await cas("chaque action de modération a son titre — c'est lui, et lui seul, qui la distingue", () => {
    // La teinte distinguait les actions avant la demande « aucune couleur ».
    // Toute la charge repose donc sur le titre : deux actions opposées qui
    // partageraient le même laisseraient la carte illisible au coup d'œil.
    for (const [action, meta] of Object.entries(SANCTIONS)) {
      assert.ok(meta.titre, `${action} doit avoir un titre`);
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(meta.couleur));
      assert.ok(m, `${action} : couleur invalide`);
      assert.ok(m[1].toLowerCase() === m[2].toLowerCase() && m[2].toLowerCase() === m[3].toLowerCase(), `${action} : teinte non neutre — ${meta.couleur}`);
    }
    // La contrainte posée et la contrainte levée doivent se lire différemment.
    assert.notStrictEqual(SANCTIONS.ban.titre, SANCTIONS.unmute.titre);
    assert.notStrictEqual(SANCTIONS.mute.titre, SANCTIONS.unmute.titre);
    assert.notStrictEqual(SANCTIONS.timeout.titre, SANCTIONS.untimeout.titre);
  });

  await cas("une carte de sanction porte le nom de fichier de son action", async () => {
    const carte = await carteSanctionMessage({
      action: "kick",
      cible: membre("444", "Trollus#0009"),
      moderateur: { tag: "uo067#0001" },
      raison: "spam",
      serveur: "Yunara",
    });
    assert.strictEqual(carte.files[0].name, "kick.png");
    assert.ok(estPNG(carte.files[0].attachment));
  });

  await cas("une action inconnue ne produit PAS de carte — l'appelant garde son message texte", async () => {
    const carte = await carteSanctionMessage({ action: "teleportation", cible: membre("1", "a#1"), moderateur: { tag: "b#2" } });
    assert.strictEqual(carte, null);
  });

  await cas("un rendu impossible renvoie null au lieu de jeter — la commande peut confirmer autrement", async () => {
    // `membre` manquant : le rendu lève, et carteActionMessage doit l'absorber.
    const carte = await carteActionMessage({ titre: "Test", couleur: "#4ade80", lignes: [] });
    assert.strictEqual(carte, null, "l'échec de rendu ne doit jamais remonter à l'appelant");
  });

  console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
})();
