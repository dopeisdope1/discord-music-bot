/**
 * Reproduit et verrouille le bug observé EN PRODUCTION plusieurs fois par
 * jour (utils/componentsV2.js) :
 *
 *   embeds[MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2]:
 *   The 'embeds' field cannot be used when using MessageFlags.IS_COMPONENTS_V2
 *
 * Discord refuse de remplacer un message Components V2 par un message à
 * embeds. Les cartes de formulaire sont en V2 et les commandes qu'elles
 * lancent répondent presque toutes par un embed de statut : le résultat ne
 * pouvait donc PAS prendre la place de la carte et repartait en message
 * éphémère à côté — précisément ce que l'intégration du résultat devait
 * supprimer.
 *
 * Ce que ce fichier garantit : le contenu de l'embed survit à la conversion
 * (rien ne doit disparaître au passage), et `content`/`embeds` disparaissent
 * bien du payload — les laisser, même vides, reproduit l'erreur.
 *
 * Lancement : node scripts/test-reponse-v2.js
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "v2-test-"));
process.env.BOT_OWNER_IDS = "owner-1";

const { MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } = require("discord.js");
const { enConteneurV2, majSure, texteDUnEmbed, estV2 } = require("../utils/componentsV2");
const { buildStatusEmbed } = require("../utils/statusEmbed");

let reussis = 0;
function cas(nom, fn) {
  try {
    fn();
    reussis++;
    console.log(`  ok — ${nom}`);
  } catch (err) {
    console.error(`  ÉCHEC — ${nom}\n    ${err.stack}`);
    process.exitCode = 1;
  }
}

/** Tout le texte porté par les composants d'un payload converti. */
function texteDe(payload) {
  const lire = (n) => [n.content || "", ...(n.components || []).map(lire)].join("\n");
  return payload.components.map((c) => lire(typeof c.toJSON === "function" ? c.toJSON() : c)).join("\n");
}

console.log("Un embed devient un message Components V2 valide :");

cas("le payload converti ne porte PLUS de champ `embeds` ni `content`", () => {
  // C'est LA condition que Discord vérifie : leur seule présence, même vide,
  // fait rejeter tout le message.
  const converti = enConteneurV2({ content: "salut", embeds: [buildStatusEmbed("success", "Membre banni.")] });
  assert.strictEqual(converti.embeds, undefined, "le champ embeds doit disparaître");
  assert.strictEqual(converti.content, undefined, "le champ content doit disparaître");
  assert.ok(Number(converti.flags) & Number(MessageFlags.IsComponentsV2), "le drapeau V2 doit être posé");
});

cas("le TEXTE de l'embed survit — la conversion ne doit rien perdre", () => {
  const converti = enConteneurV2({ embeds: [buildStatusEmbed("success", "Membre banni.")] });
  assert.ok(texteDe(converti).includes("Membre banni."), texteDe(converti));
});

cas("titre, champs et pied de page survivent aussi", () => {
  const embed = new EmbedBuilder()
    .setTitle("Bannissement")
    .setDescription("Action appliquée.")
    .addFields({ name: "Raison", value: "Publicité" }, { name: "Case", value: "#42" })
    .setFooter({ text: "par dopeisdope" });
  const texte = texteDe(enConteneurV2({ embeds: [embed] }));
  for (const attendu of ["Bannissement", "Action appliquée.", "Raison", "Publicité", "Case", "#42", "dopeisdope"]) {
    assert.ok(texte.includes(attendu), `"${attendu}" perdu : ${texte}`);
  }
});

cas("le contenu texte simple est converti lui aussi", () => {
  // `content` est tout aussi interdit que `embeds` sur un message V2.
  const converti = enConteneurV2({ content: "C'est fait." });
  assert.ok(texteDe(converti).includes("C'est fait."), texteDe(converti));
  assert.strictEqual(converti.content, undefined);
});

cas("les boutons du payload d'origine sont CONSERVÉS", () => {
  // Les perdre rendrait une confirmation impossible à valider.
  const rangee = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("go").setLabel("Confirmer").setStyle(ButtonStyle.Danger)
  );
  const converti = enConteneurV2({ embeds: [buildStatusEmbed("info", "Confirmer ?")], components: [rangee] });
  assert.strictEqual(converti.components.length, 2, "le conteneur PUIS la rangée de boutons");
  assert.strictEqual(converti.components[1], rangee);
});

cas("une pièce jointe est affichée par une galerie — sinon elle resterait invisible", () => {
  // Sur un message V2, un fichier qu'aucun composant ne référence ne s'affiche
  // pas : c'était le seul cas que l'ancienne version locale savait traiter.
  const fichier = new AttachmentBuilder(Buffer.from([1, 2, 3]), { name: "carte.png" });
  const converti = enConteneurV2({ files: [fichier] });
  const json = converti.components[0].toJSON();
  const galerie = json.components.find((c) => c.type === 12);
  assert.ok(galerie, "une MediaGallery doit porter la pièce jointe");
  assert.strictEqual(galerie.items[0].media.url, "attachment://carte.png");
});

console.log("\nLa conversion ne touche à rien d'autre :");

cas("un payload DÉJÀ en Components V2 ressort inchangé", () => {
  const v2 = { flags: MessageFlags.IsComponentsV2, components: [] };
  assert.strictEqual(enConteneurV2(v2), v2);
  assert.ok(estV2(v2));
});

cas("un payload sans texte, sans embed et sans fichier ressort inchangé", () => {
  const rien = { components: [] };
  assert.strictEqual(enConteneurV2(rien), rien);
  assert.strictEqual(enConteneurV2(null), null);
});

cas("un texte démesuré est borné — le plafond Discord est de 4000 caractères CUMULÉS", () => {
  // Embed brut et non EmbedBuilder : le builder refuse lui-même au-delà de
  // 4096 caractères, or c'est le cumul de PLUSIEURS embeds qui déborde.
  const converti = enConteneurV2({ embeds: [{ description: "x".repeat(4000) }, { description: "y".repeat(4000) }] });
  assert.ok(texteDe(converti).length <= 4000, `${texteDe(converti).length} caractères`);
});

console.log("\nmajSure ne convertit que si le message CIBLE est en V2 :");

cas("message cible classique -> le payload passe tel quel", () => {
  // Convertir à l'aveugle transformerait des réponses parfaitement valides en
  // messages V2 sans raison.
  let recu = null;
  const payload = { embeds: [buildStatusEmbed("success", "ok")] };
  majSure({ message: { flags: 0 }, update: async (p) => { recu = p; } }, payload);
  assert.strictEqual(recu, payload);
});

cas("message cible en V2 -> le payload est converti", () => {
  let recu = null;
  const interaction = {
    message: { flags: { bitfield: Number(MessageFlags.IsComponentsV2) } },
    update: async (p) => { recu = p; },
  };
  majSure(interaction, { embeds: [buildStatusEmbed("success", "débanni")] });
  assert.strictEqual(recu.embeds, undefined, "l'embed aurait été refusé par Discord");
  assert.ok(texteDe(recu).includes("débanni"), texteDe(recu));
});

cas("un embed vide ne fait pas planter la conversion", () => {
  assert.doesNotThrow(() => enConteneurV2({ embeds: [{}] }));
  assert.deepStrictEqual(texteDUnEmbed(undefined), { texte: "", image: null });
});

console.log(`\n${reussis} cas vérifiés${process.exitCode ? " — des cas ont échoué." : ", tout est vert."}`);
