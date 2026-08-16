const { createRateLimiter } = require("./rateLimiter");
const { randomClearJoke } = require("./jokes");
const { sendLog } = require("./actionLogger");
const { buildStatusEmbed } = require("./statusEmbed");
const { deleteMessages } = require("./deleteMessages");

// Déclencheurs texte exacts (insensibles à la casse, pas de préfixe requis,
// accessibles à tout le monde) — chacun supprime les messages de son propre
// auteur dans le salon. Repris de l'ancien système (5 usages / 25 min / membre),
// même format de confirmation (embed classique minimal, pas de carte Components V2).
const TRIGGERS = new Set(["uo clear", "anas clear", "yanis clear"]);
const limiter = createRateLimiter(5, 25 * 60_000);

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

  const { allowed, retryAfterMs } = limiter.check(message.author.id);
  if (!allowed) {
    const minutes = Math.ceil(retryAfterMs / 60_000);
    const warning = await channel
      .send({ embeds: [buildStatusEmbed("error", `Tu as atteint la limite (5 utilisations / 25 min). Réessaie dans ${minutes} min.`)] })
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

  sendLog(client, message.guild.id, "moderation", {
    title: "Self-clear",
    description: `${message.author.tag} a supprimé ${count} de ses propres messages via "${content}".`,
    actor: message.author,
  });

  return true;
}

module.exports = { handleSelfClear, TRIGGERS };
