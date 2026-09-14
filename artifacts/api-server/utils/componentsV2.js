const {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
} = require("discord.js");

// Conversion d'une réponse CLASSIQUE (content / embeds / pièces jointes) en
// message Components V2.
//
// LE PROBLÈME QU'ELLE RÉSOUT, observé en production plusieurs fois par jour :
//   embeds[MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2]:
//   The 'embeds' field cannot be used when using MessageFlags.IS_COMPONENTS_V2
// Discord REFUSE de remplacer un message Components V2 par un message à
// embeds : les deux mondes ne se mélangent pas sur un même message. Or les
// cartes de formulaire (utils/commandForms.js) sont en V2, et les commandes
// qu'elles lancent répondent presque toutes par un embed de statut
// (utils/statusEmbed.js, utilisé par 29 modules). Le résultat ne pouvait donc
// pas prendre la place de la carte et repartait en message éphémère à côté —
// exactement ce que l'intégration du résultat dans la carte devait supprimer.
//
// Convertir plutôt que renoncer : le contenu de l'embed est réémis en
// TextDisplay, ce qui donne le même texte dans un message que Discord accepte.

// Discord plafonne le texte affichable de TOUS les composants d'un message
// CUMULÉ à 4000 caractères. Une description d'embed peut aller jusqu'à 4096 à
// elle seule : on borne, avec de la marge pour les autres blocs.
const MAX_TEXTE = 3500;

/** Un embed (builder ou objet brut) en texte Discord. */
function texteDUnEmbed(embed) {
  const data = typeof embed?.toJSON === "function" ? embed.toJSON() : embed || {};
  const lignes = [];
  if (data.author?.name) lignes.push(`-# ${data.author.name}`);
  if (data.title) lignes.push(`## ${data.title}`);
  if (data.description) lignes.push(data.description);
  for (const champ of data.fields || []) {
    // Le nom d'un champ tient lieu de sous-titre : sans le gras, il se
    // confondrait avec sa propre valeur.
    if (champ?.name) lignes.push(`**${champ.name}**`);
    if (champ?.value) lignes.push(champ.value);
  }
  if (data.footer?.text) lignes.push(`-# ${data.footer.text}`);
  return {
    texte: lignes.filter(Boolean).join("\n"),
    // Une image d'embed est très souvent un `attachment://` : elle reste
    // affichable telle quelle dans une galerie.
    image: data.image?.url || data.thumbnail?.url || null,
  };
}

/** Déjà en Components V2 ? Alors il n'y a rien à convertir. */
function estV2(payload) {
  return Boolean(Number(payload?.flags || 0) & Number(MessageFlags.IsComponentsV2));
}

/**
 * Rend un payload compatible avec un message Components V2.
 *
 * Renvoie le payload INCHANGÉ quand il n'y a rien à convertir (déjà en V2, ou
 * ni texte ni embed ni fichier) : la fonction doit pouvoir être appliquée sans
 * réfléchir, y compris là où elle ne sert à rien.
 *
 * @param {object} payload réponse au format classique
 * @returns {object} payload en Components V2
 */
function enConteneurV2(payload) {
  if (!payload) return payload;
  if (estV2(payload)) {
    // Un payload déjà en V2 ne devrait plus porter `content`/`embeds` — mais
    // un appelant en amont (spread d'un ancien payload classique sur une carte
    // V2, par exemple) peut en laisser traîner un malgré tout. Les VIDER
    // plutôt que renvoyer tel quel : sinon Discord refuse tout le message
    // (content[MESSAGE_CANNOT_USE_LEGACY_FIELDS_WITH_COMPONENTS_V2]), observé
    // en production via utils/fakeMessage.js.
    if (payload.content === undefined && payload.embeds === undefined) return payload;
    const nettoye = { ...payload };
    delete nettoye.content;
    delete nettoye.embeds;
    return nettoye;
  }

  const contenu = typeof payload.content === "string" ? payload.content.trim() : "";
  const embeds = payload.embeds || [];
  const fichiers = payload.files || [];
  if (!contenu && !embeds.length && !fichiers.length) return payload;

  const container = new ContainerBuilder();
  let budget = MAX_TEXTE;
  let premier = true;

  /** Ajoute un bloc de texte, séparé du précédent, dans la limite du budget. */
  const ajouterTexte = (texte) => {
    const propre = String(texte || "").slice(0, budget).trim();
    if (!propre) return;
    if (!premier) container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(propre));
    budget -= propre.length;
    premier = false;
  };

  if (contenu) ajouterTexte(contenu);

  const images = [];
  for (const embed of embeds) {
    const { texte, image } = texteDUnEmbed(embed);
    ajouterTexte(texte);
    if (image) images.push(image);
  }
  // Les pièces jointes du payload s'affichent par la galerie : sur un message
  // V2, un fichier joint qu'aucun composant ne référence reste invisible.
  for (const fichier of fichiers) {
    if (fichier?.name) images.push(`attachment://${fichier.name}`);
  }

  if (images.length) {
    if (!premier) container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(...images.map((url) => new MediaGalleryItemBuilder().setURL(url)))
    );
    premier = false;
  }

  // Les rangées de boutons éventuelles du payload d'origine sont conservées,
  // à la suite du conteneur : les perdre rendrait la réponse inutilisable
  // (une confirmation sans ses boutons, par exemple).
  const composants = [container, ...(payload.components || [])];

  const converti = { ...payload, flags: Number(payload.flags || 0) | Number(MessageFlags.IsComponentsV2), components: composants };
  // `content` et `embeds` doivent DISPARAÎTRE : les laisser, même vides,
  // reproduit l'erreur que cette fonction existe pour éviter.
  delete converti.content;
  delete converti.embeds;
  return converti;
}

/**
 * `interaction.update` sûr : convertit le payload seulement si le message à
 * modifier est réellement en Components V2.
 *
 * On regarde le message CIBLE et pas le payload : c'est lui qui décide, et
 * convertir à l'aveugle transformerait des réponses classiques parfaitement
 * valides en messages V2 sans raison.
 */
function majSure(interaction, payload) {
  const message = interaction?.message;
  const cibleEstV2 = Boolean(Number(message?.flags?.bitfield ?? message?.flags ?? 0) & Number(MessageFlags.IsComponentsV2));
  return interaction.update(cibleEstV2 ? enConteneurV2(payload) : payload);
}

module.exports = { enConteneurV2, majSure, texteDUnEmbed, estV2 };
