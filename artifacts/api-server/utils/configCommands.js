const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const { getPrefixes, setPrefix, prefixConflicts, prefixConflictMessage } = require("./prefixStore");
const permStore = require("./permissions/store");
const permCatalog = require("./permissions/catalog");
const welcomeStore = require("./welcomeStore");
const leaveStore = require("./leaveStore");
const ticketStore = require("./ticketStore");
const accessStore = require("./accessStore");

// Équivalents texte des rubriques de &panel qui n'en avaient pas encore
// (Préfixes, Permissions, Bienvenue, Tickets, Vocaux). Mêmes stores que le
// panel : ce sont deux façons de régler la même chose, pas deux réglages.

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });

// `&prefix <valeur>` reste volontairement compatible avec l'ancien réglage :
// il change le préfixe de gestion (&). Les noms explicites permettent
// désormais de régler chaque famille sans ambiguïté.
const PREFIX_TYPES = {
  management: "musicMod",
  gestion: "musicMod",
  commands: "musicMod",
  commandes: "musicMod",
  musicmod: "musicMod",
  moderation: "moderation",
  modération: "moderation",
  mod: "moderation",
  security: "protection",
  securite: "protection",
  sécurité: "protection",
  protection: "protection",
  vocal: "owner",
  voice: "owner",
  owner: "owner",
};

const PREFIX_LABELS = {
  musicMod: "Préfixe des commandes (gestion)",
  moderation: "Préfixe modération",
  protection: "Préfixe sécurité/protection",
  owner: "Préfixe vocal/owner",
};
const PREFIX_HELP_COMMANDS = {
  musicMod: "help",
  moderation: "ban",
  protection: "help",
  owner: "help",
};

/** Clé de permission visée, tolérante à la casse et aux espaces parasites. */
function resolvePermissionKey(raw) {
  const cherche = (raw || "").trim().toLowerCase();
  if (!cherche) return null;
  const toutes = permCatalog.byCategory().flatMap((g) => g.permissions);
  return toutes.find((p) => p.key.toLowerCase() === cherche)?.key || null;
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
          "`prefix music|gestion|moderation|security|vocal <nouveau>`",
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
   * &set perm <clé> <@rôle|@membre> — accorde une permission.
   * Le panel fait la même chose en trois menus ; ici c'est en une ligne.
   */
  async setPerm(client, message, args) {
    if (!can(message.member, "panel.permissions.manage")) return;

    const key = resolvePermissionKey(args[0]);
    if (!key) {
      const clés = permCatalog.byCategory().map((g) => `> **${g.label}** : ${g.permissions.map((p) => `\`${p.key}\``).join(", ")}`);
      return reply(message, "error", ["Clé de permission inconnue. Clés disponibles :", ...clés].join("\n").slice(0, 3800));
    }

    const role = message.mentions.roles?.first();
    const membre = message.mentions.users?.first();
    if (!role && !membre) return reply(message, "error", "Indique un rôle ou un membre : `set perm moderation.kick @rôle`.");

    if (role) {
      const actuelles = permStore.getRoleGrants(message.guild.id, role.id);
      if (actuelles.includes(key)) return reply(message, "info", `${role} a déjà \`${key}\`.`);
      permStore.setRoleGrants(message.guild.id, role.id, [...actuelles, key]);
      return reply(message, "success", `\`${key}\` accordée à ${role}.`);
    }

    const ajoute = permStore.grantToUser(message.guild.id, membre.id, key);
    return reply(message, ajoute ? "success" : "info", ajoute ? `\`${key}\` accordée à <@${membre.id}>.` : `<@${membre.id}> a déjà \`${key}\`.`);
  },

  /** &del perm <clé> <@rôle|@membre> — retire une permission. */
  async delPerm(client, message, args) {
    if (!can(message.member, "panel.permissions.manage")) return;

    const key = resolvePermissionKey(args[0]);
    if (!key) return reply(message, "error", "Indique la clé à retirer : `del perm moderation.kick @rôle`.");

    const role = message.mentions.roles?.first();
    const membre = message.mentions.users?.first();
    if (!role && !membre) return reply(message, "error", "Indique un rôle ou un membre.");

    if (role) {
      const actuelles = permStore.getRoleGrants(message.guild.id, role.id);
      if (!actuelles.includes(key)) return reply(message, "info", `${role} n'a pas \`${key}\`.`);
      permStore.setRoleGrants(
        message.guild.id,
        role.id,
        actuelles.filter((k) => k !== key)
      );
      return reply(message, "success", `\`${key}\` retirée à ${role}.`);
    }

    const retire = permStore.revokeFromUser(message.guild.id, membre.id, key);
    return reply(message, retire ? "success" : "info", retire ? `\`${key}\` retirée à <@${membre.id}>.` : `<@${membre.id}> n'avait pas \`${key}\`.`);
  },

  /** &clear perms <@rôle|@membre> — retire TOUTES les permissions accordées. */
  async clearPerms(client, message) {
    if (!can(message.member, "panel.permissions.manage")) return;

    const role = message.mentions.roles?.first();
    const membre = message.mentions.users?.first();
    if (!role && !membre) return reply(message, "error", "Indique le rôle ou le membre à vider : `clear perms @rôle`.");

    if (role) {
      const combien = permStore.getRoleGrants(message.guild.id, role.id).length;
      if (!combien) return reply(message, "info", `${role} n'avait aucune permission accordée.`);
      permStore.setRoleGrants(message.guild.id, role.id, []);
      return reply(message, "success", `${combien} permission(s) retirée(s) à ${role}.`);
    }

    const vide = permStore.clearUserGrants(message.guild.id, membre.id);
    return reply(message, vide ? "success" : "info", vide ? `Permissions individuelles de <@${membre.id}> retirées.` : `<@${membre.id}> n'en avait aucune.`);
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

module.exports = { configHandlers: handlers, resolvePermissionKey };
