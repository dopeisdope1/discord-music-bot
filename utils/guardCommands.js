const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const guardConfig = require("./guard/config");
const guardWhitelist = require("./guard/whitelist");
const { ALL_GUARDS } = require("./guard/definitions");

// Équivalents texte de &panel > Anti-nuke. Même store (utils/guard/config.js)
// et même whitelist que le panel : deux façons de régler la même chose.

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });
const PERMISSION = "protection.guard.manage";

// Un nom de commande par guard. La clé "antirole-admin" porte un tiret, qui
// n'est pas tapable comme nom de commande : elle s'écrit "antiroleadmin".
const COMMAND_TO_GUARD = Object.fromEntries(ALL_GUARDS.map((d) => [d.key.replace(/-/g, ""), d.key]));

/**
 * "max" est accepté comme synonyme de "on" : le catalogue documente
 * `<off/on/max>` (repris de la référence CrowBot), mais ces guards sont
 * binaires — il n'existe pas de palier intermédiaire à régler. Mieux vaut
 * l'accepter et faire ce qui est attendu que refuser un mot documenté.
 */
function readOnOff(word) {
  const sub = (word || "").toLowerCase();
  if (sub === "on" || sub === "max") return true;
  if (sub === "off") return false;
  return null;
}

/** Corps commun de &antibot/&antichannel/&antiban/... */
async function setGuard(client, message, args, guardKey) {
  if (!can(message.member, PERMISSION)) return;

  const definition = ALL_GUARDS.find((d) => d.key === guardKey);
  const wanted = readOnOff(args[0]);

  if (wanted === null) {
    // guardConfig.isGuardEnabled() répond "est-ce que ça se déclenchera",
    // interrupteur général compris. Ici on veut l'état DU GUARD, et dire
    // séparément si le général le neutralise — sinon un guard bien activé
    // s'afficherait "désactivé" sans qu'on sache pourquoi.
    const actif = !guardConfig.getConfig(message.guild.id).disabledGuards.includes(guardKey);
    const global = guardConfig.getConfig(message.guild.id).enabled;
    return reply(
      message,
      "info",
      [
        `> **${definition.label}** : ${actif ? "activé" : "désactivé"}`,
        `> Déclenchement : ${definition.threshold ? `${definition.threshold.count} en ${definition.threshold.windowMs / 1000}s` : "immédiat"}`,
        actif && !global ? "> ⚠️ Neutralisé : l'anti-nuke général est désactivé (`&antinuke on`)." : null,
        "",
        `\`${message.content.trim().split(/\s+/)[0]} on\` ou \`off\`.`,
      ]
        .filter((l) => l !== null)
        .join("\n")
    );
  }

  guardConfig.setGuardEnabled(message.guild.id, guardKey, wanted);
  const global = guardConfig.getConfig(message.guild.id).enabled;
  return reply(
    message,
    "success",
    [
      `**${definition.label}** ${wanted ? "activé" : "désactivé"}.`,
      // Un guard actif alors que l'interrupteur général est coupé ne
      // déclenche rien : le taire ferait croire à une protection en place.
      wanted && !global ? "\n⚠️ L'anti-nuke général est **désactivé** — ce guard ne se déclenchera pas. `&antinuke on` pour l'activer." : null,
    ]
      .filter(Boolean)
      .join("")
  );
}

const handlers = {
  /** &secur [on/off/max] — interrupteur général, alias texte de &antinuke on/off. */
  async secur(client, message, args) {
    if (!can(message.member, PERMISSION)) return;
    const wanted = readOnOff(args[0]);
    const config = guardConfig.getConfig(message.guild.id);

    if (wanted === null) {
        const desactives = guardConfig.getConfig(message.guild.id).disabledGuards;
      const actifs = ALL_GUARDS.filter((d) => !desactives.includes(d.key));
      return reply(
        message,
        "info",
        [
          `> **Anti-nuke** : ${config.enabled ? "activé" : "désactivé"}`,
          `> **Sanction** : ${config.punishment}`,
          `> **Guards actifs** : ${actifs.length} / ${ALL_GUARDS.length}`,
          `> **Whitelist** : ${guardWhitelist.getWhitelist(message.guild.id).users.length} membre(s)`,
        ].join("\n")
      );
    }

    guardConfig.setEnabled(message.guild.id, wanted);
    return reply(message, "success", `Anti-nuke ${wanted ? "activé" : "désactivé"}.`);
  },

  /** &punition all <timeout/kick/ban> — la sanction est globale, pas par guard. */
  async punition(client, message, args) {
    if (!can(message.member, PERMISSION)) return;
    const mots = args.map((a) => a.toLowerCase());
    const sanction = mots.find((m) => guardConfig.PUNISHMENTS.includes(m));

    if (!sanction) {
      return reply(
        message,
        "info",
        [
          `> **Sanction actuelle** : ${guardConfig.getConfig(message.guild.id).punishment}`,
          "",
          `\`punition all <${guardConfig.PUNISHMENTS.join("/")}>\``,
        ].join("\n")
      );
    }

    guardConfig.setPunishment(message.guild.id, sanction);
    return reply(
      message,
      "success",
      // La sanction ne se règle pas guard par guard dans ce bot : le dire
      // plutôt que d'ignorer silencieusement un premier argument précis.
      `Sanction de l'anti-nuke réglée sur **${sanction}** — pour tous les guards, la sanction n'est pas réglable individuellement.`
    );
  },

  /** &wl [@membre] — whitelist de l'anti-nuke (distincte de &whitelist, qui est celle de l'anti-spam). */
  async wl(client, message, args) {
    if (!can(message.member, PERMISSION)) return;
    const membre = message.mentions.users?.first();
    const role = message.mentions.roles?.first();
    const rawId = args.find((a) => /^\d{15,25}$/.test(a));

    if (!membre && !role && !rawId) {
      const { users, roles } = guardWhitelist.getWhitelist(message.guild.id);
      return reply(
        message,
        "info",
        [
          `> **Membres** : ${users.length ? users.map((id) => `<@${id}>`).join(", ") : "*aucun*"}`,
          `> **Rôles** : ${roles.length ? roles.map((id) => `<@&${id}>`).join(", ") : "*aucun*"}`,
        ].join("\n")
      );
    }

    if (role) {
      const ajoute = guardWhitelist.add(message.guild.id, "roles", role.id);
      return reply(message, ajoute ? "success" : "info", ajoute ? `${role} ajouté à la whitelist anti-nuke.` : `${role} y était déjà.`);
    }
    const id = membre?.id || rawId;
    const ajoute = guardWhitelist.add(message.guild.id, "users", id);
    return reply(message, ajoute ? "success" : "info", ajoute ? `<@${id}> ajouté à la whitelist anti-nuke.` : `<@${id}> y était déjà.`);
  },

  /** &unwl <@membre/ID> */
  async unwl(client, message, args) {
    if (!can(message.member, PERMISSION)) return;
    const role = message.mentions.roles?.first();
    const membre = message.mentions.users?.first();
    const rawId = args.find((a) => /^\d{15,25}$/.test(a));
    if (!membre && !role && !rawId) return reply(message, "error", "Indique un membre ou un rôle : `unwl @membre`.");

    if (role) {
      const retire = guardWhitelist.remove(message.guild.id, "roles", role.id);
      return reply(message, retire ? "success" : "info", retire ? `${role} retiré de la whitelist anti-nuke.` : `${role} n'y était pas.`);
    }
    const id = membre?.id || rawId;
    const retire = guardWhitelist.remove(message.guild.id, "users", id);
    return reply(message, retire ? "success" : "info", retire ? `<@${id}> retiré de la whitelist anti-nuke.` : `<@${id}> n'y était pas.`);
  },
};

for (const [command, guardKey] of Object.entries(COMMAND_TO_GUARD)) {
  handlers[command] = (client, message, args) => setGuard(client, message, args, guardKey);
}

module.exports = { guardHandlers: handlers, COMMAND_TO_GUARD, readOnOff };
