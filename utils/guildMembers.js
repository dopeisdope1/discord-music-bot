/**
 * Récupère tous les membres d'un serveur, en réutilisant le cache s'il
 * semble déjà complet plutôt que de renvoyer systématiquement une requête
 * gateway ("Request Guild Members", opcode 8) — cette requête est
 * rate-limitée côté Discord, et des fonctionnalités qui l'appellent en
 * rafale (`.massrole`, `.banall`, le panel "rôles en masse"...) finissaient
 * par échouer avec un `GatewayRateLimitError` lors de tests rapprochés.
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<import('discord.js').Collection<string, import('discord.js').GuildMember>>}
 */
async function fetchAllMembers(guild) {
  if (guild.members.cache.size >= guild.memberCount) return guild.members.cache;
  return guild.members.fetch();
}

/**
 * Message clair à afficher si `fetchAllMembers` échoue à cause du
 * rate-limit gateway, plutôt que le message générique "Une erreur est
 * survenue, réessaie." qui ne dit pas quoi faire.
 * @param {unknown} err
 * @returns {string|null} message si l'erreur est identifiée, sinon null (laisser le message générique habituel)
 */
function memberFetchErrorMessage(err) {
  if (err?.name === "GatewayRateLimitError") {
    return "Discord limite les requêtes vers la liste des membres pour l'instant (trop d'appels rapprochés) — réessaie dans une quinzaine de secondes.";
  }
  return null;
}

module.exports = { fetchAllMembers, memberFetchErrorMessage };
