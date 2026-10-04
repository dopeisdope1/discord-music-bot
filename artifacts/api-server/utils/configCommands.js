const { buildStatusEmbed } = require("./statusEmbed");
const { can, peutGererNiveaux } = require("./permissions/engine");
const { getPrefixes, setPrefix, prefixConflicts, prefixConflictMessage } = require("./prefixStore");
const levelStore = require("./permissions/levelStore");
const { LEVEL_MIN, LEVEL_MAX } = require("./permissions/levelCatalog");
const welcomeStore = require("./welcomeStore");
const leaveStore = require("./leaveStore");
const ticketStore = require("./ticketStore");
const accessStore = require("./accessStore");

// Équivalents texte des rubriques de &panel qui n'en avaient pas encore
// (Préfixes, Permissions, Bienvenue, Tickets, Vocaux). Mêmes stores que le
// panel : ce sont deux façons de régler la même chose, pas deux réglages.

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text, { guildId: message.guild.id })] });

// `&prefix <valeur>` reste volontairement compatible avec l'ancien réglage :
// il change le préfixe de gestion (&). Les noms explicites permettent
// désormais de régler chaque famille sans ambiguïté.
const PREFIX_TYPES = {
  management: "musicMod",
  gestion: "musicMod",
  commands: "musicMod",
  commandes: "musicMod",
  musicmod: "musicMod",
};

const PREFIX_LABELS = {
  musicMod: "Préfixe des commandes (gestion)",
};
const PREFIX_HELP_COMMANDS = {
  musicMod: "help",
};

/** Niveau (1-9) valide, ou null si l'argument n'en est pas un. */
function resolveLevel(raw) {
  const n = parseInt((raw || "").trim(), 10);
  return Number.isInteger(n) && n >= LEVEL_MIN && n <= LEVEL_MAX ? n : null;
}

const handlers = {
  /** &prefix <préfixe> — change le préfixe des commandes (rubrique Préfixes). */
  async prefix(client, message, args) {
    if (!can(message.member, "sys")) return;
    const requestedType = (args[0] || "").trim().toLowerCase();
    const explicitType = PREFIX_TYPES[requestedType];
    const type = explicitType || "musicMod";
    const nouveau = (explicitType ? args[1] : args[0] || "").trim();

    if (!nouveau) {
      const prefixes = getPrefixes(message.guild.id);
      return reply(
        message,
        "info",
        [
          ...Object.keys(PREFIX_LABELS).map((key) => `> **${PREFIX_LABELS[key]}** : \`${prefixes[key]}\``),
          "",
          "`prefix <nouveau>` (gestion, syntaxe historique)",
          "`prefix music|gestion <nouveau>`",
        ].join("\n")
      );
    }
    // Un préfixe long ou contenant une espace rendrait toutes les commandes
    // intapables : mieux vaut refuser que de verrouiller le bot.
    if (nouveau.length > 3 || /\s/.test(nouveau)) {
      return reply(message, "error", "Un préfixe fait 3 caractères au maximum, sans espace.");
    }

    const prefixes = getPrefixes(message.guild.id);
    const conflicts = prefixConflicts({ ...prefixes, [type]: nouveau });
    if (conflicts.length) {
      return reply(message, "error", `Préfixe refusé : ${prefixConflictMessage(conflicts)}. Choisis un préfixe qui ne commence pas par un autre.`);
    }

    setPrefix(message.guild.id, type, nouveau);
    return reply(
      message,
      "success",
      `${PREFIX_LABELS[type]} réglé sur \`${nouveau}\`. Exemple : \`${nouveau}${PREFIX_HELP_COMMANDS[type]}\`.`
    );
  },

  /**
   * &set perm <niveau 1-9> <@rôle|@membre> — assigne un niveau. Réservé au
   * propriétaire du bot (voir utils/permissions/engine.js::peutGererNiveaux) :
   * attribuer un niveau est une action d'escalade potentielle, jamais
   * délégable au rang sys lui-même.
   */
  async setPerm(client, message, args) {
    if (!peutGererNiveaux(message.member)) return;

    const level = resolveLevel(args[0]);
    if (!level) {
      return reply(message, "error", `Indique un niveau entre ${LEVEL_MIN} et ${LEVEL_MAX} : \`set perm 5 @rôle\`.`);
    }

    const role = message.mentions.roles?.first();
    const membre = message.mentions.users?.first();
    if (!role && !membre) return reply(message, "error", "Indique un rôle ou un membre : `set perm 5 @rôle`.");

    if (role) {
      levelStore.setRoleLevel(message.guild.id, role.id, level);
      return reply(message, "success", `${role} réglé au niveau **${level}**.`);
    }

    levelStore.setUserLevel(message.guild.id, membre.id, level);
    return reply(message, "success", `<@${membre.id}> réglé au niveau **${level}**.`);
  },

  /** &del perm <@rôle|@membre> — retire le niveau assigné. */
  async delPerm(client, message, args) {
    if (!peutGererNiveaux(message.member)) return;

    const role = message.mentions.roles?.first();
    const membre = message.mentions.users?.first();
    if (!role && !membre) return reply(message, "error", "Indique un rôle ou un membre : `del perm @rôle`.");

    if (role) {
      const avait = levelStore.getRoleLevel(message.guild.id, role.id) != null;
      levelStore.setRoleLevel(message.guild.id, role.id, null);
      return reply(message, avait ? "success" : "info", avait ? `Niveau retiré à ${role}.` : `${role} n'avait aucun niveau assigné.`);
    }

    const avait = levelStore.getUserLevel(message.guild.id, membre.id) != null;
    levelStore.setUserLevel(message.guild.id, membre.id, null);
    return reply(message, avait ? "success" : "info", avait ? `Niveau retiré à <@${membre.id}>.` : `<@${membre.id}> n'avait aucun niveau assigné.`);
  },

  /** &clear perms <@rôle|@membre> — retire le niveau assigné (alias de &del perm). */
  async clearPerms(client, message, args) {
    return handlers.delPerm(client, message, args);
  },

  /** &join settings — réglages d'arrivée (rubrique Bienvenue). */
  async joinSettings(client, message) {
    if (!can(message.member, "server.welcome.manage")) return;
    const config = welcomeStore.getConfig(message.guild.id);
    await reply(
      message,
      "info",
      [
        `> **Salon** : ${config.channelId ? `<#${config.channelId}>` : "*aucun — désactivé*"}`,
        `> **Suppression auto** : ${config.autoDeleteSeconds ? `${config.autoDeleteSeconds}s` : "jamais"}`,
        `> **Messages** : ${config.messages.length} (tirés au hasard à chaque arrivée)`,
        ...config.messages.map((m, i) => `> ${i + 1}. *${m}*`),
        "",
        "Modification dans `&panel` > Bienvenue.",
      ].join("\n")
    );
  },

  /** &leave settings — réglages de départ (rubrique Bienvenue). */
  async leaveSettings(client, message) {
    if (!can(message.member, "server.welcome.manage")) return;
    const config = leaveStore.getConfig(message.guild.id);
    await reply(
      message,
      "info",
      [
        `> **Salon** : ${config.channelId ? `<#${config.channelId}>` : "*aucun — désactivé*"}`,
        `> **Suppression auto** : ${config.autoDeleteSeconds ? `${config.autoDeleteSeconds}s` : "jamais"}`,
        `> **Messages** : ${config.messages.length} (tirés au hasard à chaque départ)`,
        ...config.messages.map((m, i) => `> ${i + 1}. *${m}*`),
        "",
        "Modification dans `&panel` > Bienvenue.",
      ].join("\n")
    );
  },

  /** &ticket settings — rôle staff des tickets (rubrique Tickets). */
  async ticketSettings(client, message) {
    if (!can(message.member, "server.tickets.manage")) return;
    const { staffRoleId } = ticketStore.getConfig(message.guild.id);
    const existe = staffRoleId && message.guild.roles.cache.has(staffRoleId);
    await reply(
      message,
      "info",
      [
        `> **Rôle staff** : ${existe ? `<@&${staffRoleId}>` : "*aucun*"}`,
        staffRoleId && !existe ? "> ⚠️ Le rôle configuré n'existe plus sur le serveur." : null,
        "",
        "`&ticket setup [@rôle]` pour poster le bouton, `&panel` > Tickets pour changer le rôle.",
      ]
        .filter((l) => l !== null)
        .join("\n")
    );
  },

  /** &clear limit — dispensés du quota de `uo clear` (rubrique Dispenses). */
  async clearLimit(client, message) {
    if (!can(message.member, "sys")) return;
    const dispenses = accessStore.list("clear");
    await reply(
      message,
      "info",
      [
        `> **Dispensés du quota** : ${dispenses.length ? dispenses.map((id) => `<@${id}>`).join(", ") : "*personne*"}`,
        "> Les autres sont plafonnés à 2 usages de `uo clear` par 25 minutes.",
        "",
        "Modification dans `&panel` > Dispenses.",
      ].join("\n")
    );
  },
};

module.exports = { configHandlers: handlers, resolveLevel };
