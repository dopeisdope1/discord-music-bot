// À qui appartient un panneau interactif ?
//
// LE PROBLÈME : `&panel` et les cartes de commande (`&addrole`, `&ban`…) sont
// des messages PUBLICS. N'importe qui pouvait cliquer sur les menus de la
// carte ouverte par quelqu'un d'autre — au minimum en la faisant changer sous
// ses yeux, au pire en lançant une action à sa place s'il avait lui aussi le
// droit correspondant.
//
// Les droits ne suffisent pas à couvrir ça : deux modérateurs ont les mêmes
// permissions, et ce n'est pas une raison pour piloter le panneau de l'autre.
// Ce qui manque n'est pas une permission mais une NOTION DE PROPRIÉTAIRE.
//
// Les autres panneaux du bot (bannissement, ban de masse, confirmations
// d'administration) portaient déjà cette vérification, chacun avec son propre
// jeton. Celui-ci est le mécanisme générique pour ceux qui n'en avaient pas.

// Borné : le VPS n'a que 458 Mo, et un panneau vieux de plusieurs heures n'est
// plus consulté. La plus ancienne entrée s'efface en premier.
const MAX_ENTREES = 500;

/** @type {Map<string, string>} identifiant du message -> identifiant du propriétaire */
const proprietaires = new Map();

/** Retient qui a ouvert ce panneau. */
function retenir(messageId, userId) {
  if (!messageId || !userId) return;
  // Remise en tête pour que l'éviction reste bien « le plus ancien d'abord ».
  proprietaires.delete(messageId);
  proprietaires.set(messageId, userId);
  if (proprietaires.size > MAX_ENTREES) proprietaires.delete(proprietaires.keys().next().value);
}

/** @returns {string|null} */
function proprietaireDe(messageId) {
  return proprietaires.get(messageId) || null;
}

/** Envoie une réponse ET en retient le propriétaire. */
async function repondreEtRetenir(message, payload) {
  const envoye = await message.reply(payload);
  retenir(envoye?.id, message.author?.id);
  return envoye;
}

/**
 * La personne qui clique est-elle celle qui a ouvert le panneau ?
 *
 * Deux sources, dans cet ordre :
 *   1. ce qui a été retenu à l'envoi — exact, et sans aucun appel réseau ;
 *   2. à défaut, le message AUQUEL le panneau répond. Un panneau est toujours
 *      une réponse à la commande qui l'a ouvert, donc son auteur est le
 *      propriétaire. C'est ce qui rétablit la protection après un
 *      redémarrage, la mémoire étant alors vide.
 *
 * En dernier recours, on AUTORISE. Un panneau dont on ne peut plus établir le
 * propriétaire — message d'origine supprimé, cache vidé — doit rester
 * utilisable : le refuser bloquerait la personne légitime, alors que les
 * permissions, elles, continuent de s'appliquer derrière.
 *
 * @returns {Promise<{autorise: boolean, proprietaire: string|null}>}
 */
async function verifier(interaction) {
  const messageId = interaction?.message?.id;
  const clic = interaction?.user?.id;
  if (!messageId || !clic) return { autorise: true, proprietaire: null };

  let proprietaire = proprietaireDe(messageId);

  if (!proprietaire) {
    const origine = interaction.message?.reference?.messageId;
    if (origine) {
      const commande = await interaction.channel?.messages?.fetch(origine).catch(() => null);
      proprietaire = commande?.author?.id || null;
      // Mis en cache : la protection redevient gratuite pour les clics suivants.
      if (proprietaire) retenir(messageId, proprietaire);
    }
  }

  if (!proprietaire) return { autorise: true, proprietaire: null };
  return { autorise: proprietaire === clic, proprietaire };
}

/** Vide la mémoire — utilisé par les tests. */
function reinitialiser() {
  proprietaires.clear();
}

module.exports = { retenir, proprietaireDe, repondreEtRetenir, verifier, reinitialiser, MAX_ENTREES };
