const { createRateLimiter } = require("./rateLimiter");
const { randomClearJoke } = require("./jokes");
const { sendLog } = require("./actionLogger");

// Déclencheurs texte exacts (insensibles à la casse, pas de préfixe requis,
// accessibles à tout le monde) — chacun supprime les messages de son propre
// auteur dans le salon. Repris de l'ancien système (5 usages / 25 min / membre).
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

  const { allowed, retryAfterMs } = limiter.check(message.author.id);
  if (!allowed) {
    const warning = await message
      .reply(`⏳ Patiente encore ${Math.ceil(retryAfterMs / 60_000)} min avant de réutiliser ça.`)
      .catch(() => null);
    setTimeout(() => warning?.delete().catch(() => {}), 4000);
    return true;
  }

  const channel = message.channel;
  const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const toDelete = messages ? [...messages.values()].filter((m) => m.author.id === message.author.id) : [];
  const deleted = toDelete.length ? await channel.bulkDelete(toDelete, true).catch(() => []) : [];

  sendLog(client, message.guild.id, "moderation", {
    title: "Self-clear",
    description: `${message.author.tag} a supprimé ${deleted.size || toDelete.length} de ses propres messages via "${content}".`,
    actor: message.author,
  });

  const confirm = await channel.send(`🧹 ${deleted.size || toDelete.length} message(s) supprimé(s) — ${randomClearJoke()}`).catch(() => null);
  setTimeout(() => confirm?.delete().catch(() => {}), 4000);

  return true;
}

module.exports = { handleSelfClear, TRIGGERS };
