const { createRateLimiter } = require("./rateLimiter");
const { randomClearJoke } = require("./jokes");
const { buildStatusEmbed } = require("./statusEmbed");
const { deleteMessages } = require("./deleteMessages");
const clearBypassStore = require("./clearBypassStore");

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
  const { allowed, retryAfterMs } = clearBypassStore.isExempt(message.author.id)
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
  // le nombre exact une fois terminé — même séquence que l'ancien système.
  const joke = randomClearJoke();
  const tempMessage = await channel.send({ embeds: [buildStatusEmbed("success", joke)] }).catch(() => null);
  if (tempMessage) setTimeout(() => tempMessage.delete().catch(() => {}), 15_000);

  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const toDelete = messages ? [...messages.values()].filter((m) => m.author.id === message.author.id) : [];
  const count = toDelete.length ? await deleteMessages(channel, toDelete) : 0;

  tempMessage?.edit({ embeds: [buildStatusEmbed("success", `**${count}** supprimé(s) — ${joke}`)] }).catch(() => {});

  return true;
}

module.exports = { handleSelfClear, TRIGGERS };
