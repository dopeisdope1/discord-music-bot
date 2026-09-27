const fs = require("fs");
const path = require("path");
const { ecrireJson, lireJson } = require("./jsonFile");

// Règles de permission PAR COMMANDE, par serveur — couche ADDITIONNELLE
// au-dessus du moteur existant (permissions/engine.js::can + commandsStore
// on/off), jamais un remplacement. Ni owner ni rang sys ne sont jamais
// bloqués ici : cette couche règle qui d'AUTRE, en plus, a accès ou n'a pas
// accès à UNE commande précise et dans quels salons.
//
// Structure sur disque : { [guildId]: { [commandName]: Rule } }
// Rule = {
//   enabled: true|false,           // par défaut true — appartient à commandsStore
//                                    ailleurs, mais dupliqué ici pour tout
//                                    donner en une seule vue au panel.
//   allowedRoles: [roleId],
//   deniedRoles: [roleId],
//   allowedUsers: [userId],
//   deniedUsers: [userId],
//   allowedChannels: [channelId], // vide = tous les salons autorisés
//   deniedChannels: [channelId],
//   updatedAt: ISOString|null,
// }
//
// PRIORITÉ DE RÉSOLUTION (la plus spécifique gagne) :
//   1. membre explicitement INTERDIT           -> refusé
//   2. membre explicitement AUTORISÉ            -> autorisé (sous réserve du salon)
//   3. rôle explicitement INTERDIT (et aucun rôle autorisé du membre) -> refusé
//   4. rôle explicitement AUTORISÉ               -> autorisé (sous réserve du salon)
//   5. aucune règle de rôle/membre                -> ni autorisé ni refusé ici,
//      le moteur de permissions existant (can()) tranche — cette couche ne
//      DURCIT jamais un accès déjà refusé par can(), elle ne fait qu'ajouter
//      des exceptions et des restrictions supplémentaires.
//   6. salon : vérifié en dernier, comme un filtre — un salon interdit bat
//      tout le reste (même un membre autorisé) ; un salon autorisé restreint
//      la commande à cette liste si elle est non vide.

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "commandRules.json");

let cache = null;
function load() {
  if (cache) return cache;
  try {
    cache = lireJson(DATA_FILE);
  } catch {
    cache = {};
  }
  return cache;
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    ecrireJson(DATA_FILE, cache);
  } catch (err) {
    console.error("[commandRules] échec de la sauvegarde :", err);
  }
}

const EMPTY_RULE = () => ({
  allowedRoles: [],
  deniedRoles: [],
  allowedUsers: [],
  deniedUsers: [],
  allowedChannels: [],
  deniedChannels: [],
  updatedAt: null,
});

function guildEntry(guildId) {
  const data = load();
  if (!data[guildId]) data[guildId] = {};
  return data[guildId];
}

function ruleEntry(guildId, commandName) {
  const guild = guildEntry(guildId);
  if (!guild[commandName]) guild[commandName] = EMPTY_RULE();
  const rule = guild[commandName];
  // Complète une règle ancienne/partielle sans écraser ce qui existe déjà —
  // un ajout de champ futur ne doit jamais faire planter une lecture.
  for (const key of ["allowedRoles", "deniedRoles", "allowedUsers", "deniedUsers", "allowedChannels", "deniedChannels"]) {
    if (!Array.isArray(rule[key])) rule[key] = [];
  }
  return rule;
}

/** @returns {object} règle complète (jamais null) — utile pour l'afficher telle quelle dans un panel. */
function getRule(guildId, commandName) {
  return { ...ruleEntry(guildId, commandName) };
}

/** @returns {boolean} true si AU MOINS un champ de la règle est renseigné — sert à ne lister au panel que les commandes réellement configurées. */
function hasRule(guildId, commandName) {
  const r = ruleEntry(guildId, commandName);
  return (
    r.allowedRoles.length ||
    r.deniedRoles.length ||
    r.allowedUsers.length ||
    r.deniedUsers.length ||
    r.allowedChannels.length ||
    r.deniedChannels.length
  );
}

function listConfiguredCommands(guildId) {
  return Object.keys(guildEntry(guildId)).filter((name) => hasRule(guildId, name));
}

function toggleList(guildId, commandName, listName, id) {
  const rule = ruleEntry(guildId, commandName);
  const list = rule[listName];
  const idx = list.indexOf(id);
  if (idx === -1) list.push(id);
  else list.splice(idx, 1);
  rule.updatedAt = new Date().toISOString();
  save();
  return list.includes(id);
}

const toggleAllowedRole = (g, c, roleId) => toggleList(g, c, "allowedRoles", roleId);
const toggleDeniedRole = (g, c, roleId) => toggleList(g, c, "deniedRoles", roleId);
const toggleAllowedUser = (g, c, userId) => toggleList(g, c, "allowedUsers", userId);
const toggleDeniedUser = (g, c, userId) => toggleList(g, c, "deniedUsers", userId);
const toggleAllowedChannel = (g, c, channelId) => toggleList(g, c, "allowedChannels", channelId);
const toggleDeniedChannel = (g, c, channelId) => toggleList(g, c, "deniedChannels", channelId);

/** Efface toute la configuration d'une commande pour ce serveur — "réinitialiser". */
function resetRule(guildId, commandName) {
  const guild = guildEntry(guildId);
  const existed = Boolean(guild[commandName]);
  delete guild[commandName];
  save();
  return existed;
}

/**
 * Résout l'accès pour CETTE couche uniquement — ne remplace jamais can(),
 * vient en plus. Owner/rang sys : appelant doit les court-circuiter AVANT
 * d'appeler cette fonction (voir evaluate ci-dessous), cette fonction-ci ne
 * les connaît pas.
 *
 * @returns {{decision: "allow"|"deny"|"neutral", reason: string}}
 *   "allow"/"deny" tranchent définitivement ; "neutral" laisse can() décider.
 */
function resolveRoleOrUser(guildId, commandName, member) {
  const rule = ruleEntry(guildId, commandName);
  const userId = member.id;
  const roleIds = [...(member.roles?.cache?.keys?.() || [])];

  if (rule.deniedUsers.includes(userId)) return { decision: "deny", reason: "membre explicitement interdit" };
  if (rule.allowedUsers.includes(userId)) return { decision: "allow", reason: "membre explicitement autorisé" };

  const hasAllowedRole = roleIds.some((r) => rule.allowedRoles.includes(r));
  if (hasAllowedRole) return { decision: "allow", reason: "rôle explicitement autorisé" };

  const hasDeniedRole = roleIds.some((r) => rule.deniedRoles.includes(r));
  if (hasDeniedRole) return { decision: "deny", reason: "rôle explicitement interdit" };

  return { decision: "neutral", reason: "aucune règle rôle/membre" };
}

/** @returns {{decision: "allow"|"deny"|"neutral", reason: string}} */
function resolveChannel(guildId, commandName, channelId) {
  if (!channelId) return { decision: "neutral", reason: "hors salon" };
  const rule = ruleEntry(guildId, commandName);
  if (rule.deniedChannels.includes(channelId)) return { decision: "deny", reason: "salon explicitement interdit" };
  if (rule.allowedChannels.length && !rule.allowedChannels.includes(channelId)) {
    return { decision: "deny", reason: "salon hors liste des salons autorisés" };
  }
  return { decision: "allow", reason: "salon autorisé" };
}

/**
 * Point d'entrée complet : à appeler APRÈS commandsStore.isEnabledForGuild
 * (l'activation on/off reste gérée là-bas, pas ici) et APRÈS avoir vérifié
 * owner/rang sys (qui bypassent tout, cette fonction ne les voit jamais).
 *
 * @param {import('discord.js').GuildMember} member
 * @param {boolean} baseAllowed résultat de can(member, clé) — le verdict du
 *   moteur de permissions existant, que cette couche ne fait qu'affiner.
 * @returns {{allowed: boolean, reason: string}}
 */
function evaluate(guildId, commandName, member, channelId, baseAllowed) {
  const roleUser = resolveRoleOrUser(guildId, commandName, member);
  if (roleUser.decision === "deny") return { allowed: false, reason: roleUser.reason };

  let allowed = baseAllowed;
  let reason = allowed ? "autorisé par le moteur de permissions" : "refusé par le moteur de permissions";
  if (roleUser.decision === "allow") {
    allowed = true;
    reason = roleUser.reason;
  }

  if (!allowed) return { allowed: false, reason };

  const channel = resolveChannel(guildId, commandName, channelId);
  if (channel.decision === "deny") return { allowed: false, reason: channel.reason };

  return { allowed: true, reason };
}

module.exports = {
  getRule,
  hasRule,
  listConfiguredCommands,
  toggleAllowedRole,
  toggleDeniedRole,
  toggleAllowedUser,
  toggleDeniedUser,
  toggleAllowedChannel,
  toggleDeniedChannel,
  resetRule,
  resolveRoleOrUser,
  resolveChannel,
  evaluate,
};
