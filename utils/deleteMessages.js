// Le bulkDelete groupé de Discord refuse tout message de plus de 14 jours
// (erreur API) ; en dessous, la suppression individuelle (.delete()) n'a pas
// cette limite mais coûte une requête par message, donc nettement plus lente.
// Marge de sécurité sous les 14 jours pile pour éviter un rejet API sur des
// messages à la limite (l'horloge du bot n'est jamais exactement synchro
// avec celle de Discord).
const BULK_DELETE_CUTOFF_MS = 13.5 * 24 * 60 * 60 * 1000;

/**
 * Supprime une liste de messages, en groupé pour les récents (<14j) et un par
 * un pour les plus vieux.
 * @param {import('discord.js').TextBasedChannel} channel
 * @param {import('discord.js').Message[]} messages
 * @returns {Promise<number>} nombre de messages réellement supprimés
 */
async function deleteMessages(channel, messages) {
  const now = Date.now();
  const recent = [];
  const old = [];
  for (const m of messages) {
    if (now - m.createdTimestamp < BULK_DELETE_CUTOFF_MS) recent.push(m);
    else old.push(m);
  }

  let count = 0;

  if (recent.length) {
    const deleted = await channel.bulkDelete(recent, true).catch(() => null);
    count += deleted ? deleted.size : 0;
  }

  for (const m of old) {
    const ok = await m
      .delete()
      .then(() => true)
      .catch(() => false);
    if (ok) count++;
  }

  return count;
}

module.exports = { deleteMessages };
