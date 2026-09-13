const { buildStatusEmbed } = require("./statusEmbed");
const { deleteMessages } = require("./deleteMessages");
const accessStore = require("./accessStore");
const selfClearStore = require("./selfClearStore");

// Déclencheur texte exact (insensible à la casse, pas de préfixe requis,
// accessible à tout le monde) : supprime les messages de son propre auteur
// dans le salon. Format de confirmation minimal (embed classique, pas de
// carte Components V2).
//
// Les noms qui déclenchent ("<nom> clear") et le délai entre deux usages sont
// configurables PAR SERVEUR via "!!setclear" (voir utils/selfClearStore.js) —
// remplace l'ancien "uo clear" fixé en dur et son quota fixe de 2/25min.

// Dernier usage PAR SERVEUR + PAR MEMBRE (pas par nom tapé) : un cooldown
// simple remplace l'ancien compteur à fenêtre glissante, plus lisible pour un
// réglage "temps entre chaque clear" affiché à l'admin.
const lastUse = new Map();

function checkCooldown(key, cooldownMs) {
  const now = Date.now();
  const last = lastUse.get(key);
  if (last && now - last < cooldownMs) {
    return { allowed: false, retryAfterMs: cooldownMs - (now - last) };
  }
  lastUse.set(key, now);
  return { allowed: true };
}

/**
 * Messages à effacer : UNIQUEMENT ceux de la personne qui tape.
 *
 * Les messages du bot étaient emportés eux aussi, sur demande explicite. Le
 * choix a été inversé — également sur demande — et il referme au passage un
 * vrai trou : le déclencheur n'exige AUCUNE permission, si bien que n'importe
 * qui pouvait supprimer une carte de giveaway en cours, un panneau de tickets
 * ou le lecteur de musique, sans laisser de trace de modération.
 *
 * Le message déclencheur lui-même part avec, puisqu'il appartient à la
 * personne qui l'a tapé. Les confirmations du bot (« Nettoyage en cours… »)
 * ne restent pas pour autant : elles s'auto-suppriment au bout de 15 s, sans
 * dépendre de ce balayage.
 *
 * `botId` reste dans la signature : les appelants le passent déjà, et son
 * absence de tout effet est justement ce que vérifient les tests.
 *
 * @param {import('discord.js').Message[]} messages lot récupéré dans le salon
 * @param {string} authorId la personne qui a tapé le déclencheur
 * @param {string|undefined} [botId] ignoré — voir ci-dessus
 */
function collectOwnConversation(messages, authorId, botId) {
  return messages.filter((m) => m.author.id === authorId);
}

/**
 * À appeler dans messageCreate, avant/indépendamment des dispatchers
 * préfixés — ces déclencheurs n'ont pas de préfixe.
 * @returns {Promise<boolean>} true si le message était un déclencheur (géré ou rate-limité)
 */
async function handleSelfClear(client, message) {
  if (message.author.bot || !message.guild) return false;

  const content = message.content.trim().toLowerCase();
  const { names, cooldownMs } = selfClearStore.getConfig(message.guild.id);
  const matched = names.some((nom) => content === `${nom.toLowerCase()} clear`);
  if (!matched) return false;

  const channel = message.channel;

  // Le propriétaire du bot et les membres qu'il a exemptés (voir
  // ?clearbypass) ne consomment pas de quota : on ne passe même pas par le
  // cooldown, sinon leurs usages le déclencheraient pour les autres.
  const { allowed, retryAfterMs } = accessStore.isAllowed("clear", message.author.id)
    ? { allowed: true }
    : checkCooldown(`${message.guild.id}:${message.author.id}`, cooldownMs);
  if (!allowed) {
    const minutes = Math.ceil(retryAfterMs / 60_000);
    const warning = await channel
      .send({ embeds: [buildStatusEmbed("error", `Réessaie dans ${minutes} min.`)] })
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

module.exports = { handleSelfClear, collectOwnConversation };
