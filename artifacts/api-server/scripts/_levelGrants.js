/**
 * Aide de TEST uniquement : traduit l'ancienne préparation d'accès "clé par
 * clé" (setRoleGrants / grantToUser de l'ex-utils/permissions/store.js,
 * supprimé) vers le moteur actuel à niveaux (utils/permissions/levelStore.js).
 *
 * Le niveau attribué est le plus haut niveau requis parmi les clés données
 * (levelCatalog.js::levelRequiredFor) — donc le minimum qui débloque toutes
 * ces clés. Une liste vide retire le niveau du rôle.
 *
 * DATA_DIR doit être fixé AVANT de require ce module (comme pour levelStore).
 */
const levelStore = require("../utils/permissions/levelStore");
const { levelRequiredFor } = require("../utils/permissions/levelCatalog");

function niveauPour(keys) {
  let niveau = 0;
  for (const key of [].concat(keys || [])) {
    const requis = levelRequiredFor(key);
    if (requis && requis > niveau) niveau = requis;
  }
  return niveau;
}

function setRoleGrants(guildId, roleId, keys) {
  const niveau = niveauPour(keys);
  if (niveau) levelStore.setRoleLevel(guildId, roleId, niveau);
  else levelStore.clearRole(guildId, roleId);
}

function grantToUser(guildId, userId, key) {
  const niveau = Math.max(niveauPour(key), levelStore.getUserLevel(guildId, userId) || 0);
  if (niveau) levelStore.setUserLevel(guildId, userId, niveau);
}

module.exports = { setRoleGrants, grantToUser, niveauPour };
