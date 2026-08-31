const { createRateLimiter } = require("./rateLimiter");
const { buildStatusEmbed } = require("./statusEmbed");
const { deleteMessages } = require("./deleteMessages");
const accessStore = require("./accessStore");

// Déclencheurs texte exacts (insensibles à la casse, pas de préfixe requis,
// accessibles à tout le monde) — chacun supprime les messages de son propre
// auteur dans le salon. Format de confirmation minimal (embed classique, pas
// de carte Components V2).
const TRIGGERS = new Set(["uo clear", "anas clear", "yanis clear"]);

// Le quota est PAR MEMBRE et couvre les trois déclencheurs ensemble (le
// limiteur est indexé sur l'auteur, pas sur le mot tapé) : on ne peut donc
// pas contourner la limite en alternant "uo clear" et "anas clear".
const MAX_USES = 2;
const WINDOW_MS = 25 * 60_000;
const limiter = createRateLimiter(MAX_USES, WINDOW_MS);

/**
 * Messages à effacer : ceux de la personne qui tape, PLUS tous ceux du bot
 * présents dans le lot.
 *
 * Demande explicite, maintenue après avoir été discutée : "enlève tous les
 * messages du bot". Ce déclencheur n'exige aucune permission, donc n'importe
 * qui peut ainsi supprimer une carte de giveaway en cours, un panneau de
 * tickets ou le lecteur de musique. C'est assumé — le quota (2 usages par
 * 25 minutes, voir plus bas) est le seul garde-fou.
 *
 * Le message déclencheur lui-même part avec, puisqu'il appartient à la
 * personne qui l'a tapé.
 *
 * @param {import('discord.js').Message[]} messages lot récupéré dans le salon
 * @param {string} authorId la personne qui a tapé le déclencheur
 * @param {string|undefined} botId le bot lui-même
 */
function collectOwnConversation(messages, authorId, botId) {
  return messages.filter((m) => m.author.id === authorId || (botId && m.author.id === botId));
}

/**
 * À appeler dans messageCreate, avant/indépendamment des dispatchers
 * préfixés — ces déclencheurs n'ont pas de préfixe.
 * @returns {Promise<boolean>} true si le message était un déclencheur (géré ou rate-limité)
 */
async function handleSelfClear(client, message) {
  if (message.author.bot || !message.guild) return false;

  const content = message.content.trim().toLowerCase();
  if (!TRIGGERS.has(content)) return false;

  const channel = message.channel;

  // Le propriétaire du bot et les membres qu'il a exemptés (voir
  // ?clearbypass) ne consomment pas de quota : on ne passe même pas par le
  // limiteur, sinon leurs usages compteraient dans la fenêtre des autres.
  const { allowed, retryAfterMs } = accessStore.isAllowed("clear", message.author.id)
    ? { allowed: true }
    : limiter.check(message.author.id);
  if (!allowed) {
    const minutes = Math.ceil(retryAfterMs / 60_000);
    const warning = await channel
      .send({
        embeds: [
          buildStatusEmbed(
            "error",
            `Tu as atteint la limite (${MAX_USES} utilisation(s) / ${WINDOW_MS / 60_000} min). Réessaie dans ${minutes} min.`
          ),
        ],
      })
      .catch(() => null);
    setTimeout(() => warning?.delete().catch(() => {}), 15_000);
    return true;
  }

  // Envoie la confirmation tout de suite (le nettoyage peut prendre quelques
  // secondes à cause du rate-limit Discord sur bulkDelete), puis l'édite avec
  // le nombre exact une fois terminé.
  const tempMessage = await channel
    .send({ embeds: [buildStatusEmbed("success", "Nettoyage en cours…")] })
    .catch(() => null);
  if (tempMessage) setTimeout(() => tempMessage.delete().catch(() => {}), 15_000);

  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const toDelete = messages ? collectOwnConversation([...messages.values()], message.author.id, client?.user?.id) : [];
  const count = toDelete.length ? await deleteMessages(channel, toDelete) : 0;

  tempMessage?.edit({ embeds: [buildStatusEmbed("success", `**${count}** message(s) supprimé(s).`)] }).catch(() => {});

  return true;
}

module.exports = { handleSelfClear, collectOwnConversation, TRIGGERS };
