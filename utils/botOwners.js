// IDs Discord (séparés par des virgules, variable d'env BOT_OWNER_IDS) du/des
// propriétaire(s) du BOT — pas forcément le propriétaire Discord du serveur
// où il tourne. Utilisé par la file d'autorisation de `.banall`/`&banall`
// (voir utils/moderationCommands.js) : un propriétaire du bot peut autoriser
// un bannissement complet sur n'importe quel serveur.
const BOT_OWNER_IDS = (process.env.BOT_OWNER_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

/**
 * @param {string} userId
 * @returns {boolean}
 */
function isBotOwner(userId) {
  return BOT_OWNER_IDS.includes(userId);
}

/**
 * @returns {string[]}
 */
function getBotOwnerIds() {
  return [...BOT_OWNER_IDS];
}

module.exports = { isBotOwner, getBotOwnerIds };
