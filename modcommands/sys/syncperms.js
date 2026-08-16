const { PermissionFlagsBits } = require("discord.js");
const { LEVEL } = require("../../utils/permLevels");
const { loadAllCommands } = require("../../utils/modCommandLoader");
const { effectiveLevel } = require("../../utils/accessControl");
const permissionsStore = require("../../utils/permissionsStore");
const { saveGuildConfig } = require("../../utils/configChannel");

// Groupes distribués sur les rôles ordinaires, du moins au plus sensible. La
// cascade du moteur (voir utils/permissionEngine.js) fait qu'un slot hérite de
// tout ce qui est en dessous : chaque groupe ne contient donc que SON
// incrément, jamais un cumul.
//
// Volontairement limité aux commandes réversibles. Tout ce qui bannit, expulse,
// touche aux rôles ou agit en masse (kick, ban, unban, addrole, delrole,
// derank, massrole, blrank, blrole, create, unbanall, unmuteall) est absent :
// ces commandes n'arrivent que par le slot "Administrateurs", qui reçoit de
// toute façon l'intégralité des commandes configurables. Déduire un niveau de
// confiance de la seule position d'un rôle est trop fragile — un rôle
// technique haut placé (ex : un rôle qui regroupe les bots) hériterait sinon
// du droit de bannir.
const CASCADE_GROUPS = [
  { key: "Consultation", commands: ["helpall", "perms", "snipe", "gif", "rolemembers", "allbots", "alladmins"] },
  { key: "Historique des sanctions", commands: ["muteinfo", "mutelist", "baninfo", "banlist", "sanctions"] },
  { key: "Vocal", commands: ["voc"] },
  { key: "Modération légère", commands: ["clear", "mute", "unmute", "warn", "nick"] },
  { key: "Salons", commands: ["lock", "unlock", "hide", "unhide", "rename", "renew"] },
];

function configurableCommandNames() {
  const commands = [...new Set(loadAllCommands().values())];
  return commands
    .filter((c) => {
      const level = effectiveLevel(c);
      return level === LEVEL.CONFIGURABLE || level === LEVEL.CONFIGURABLE_NO_COOLDOWN;
    })
    .map((c) => c.name);
}

// Un groupe par slot, du plus bas au plus haut. Les groupes en trop ne sont
// PAS entassés dans le dernier slot : ils restent réservés aux administrateurs.
// Sinon un serveur n'ayant qu'un seul rôle ordinaire lui donnerait d'un coup
// tout l'éventail (mute, lock, rename...) — beaucoup trop pour un rôle de
// membre lambda, qui compte souvent la majorité du serveur.
// À l'inverse, s'il y a plus de slots que de groupes, les slots du haut
// n'ajoutent rien : ils héritent déjà de tout ce qui est en dessous.
function distribute(groups, slotCount) {
  return Array.from({ length: slotCount }, (_, i) => [...(groups[i]?.commands || [])]);
}

/**
 * Construit le plan sans rien écrire. Trois familles de slots :
 *   - un slot EXCLUSIF par rôle dont le nom est celui d'une commande
 *     (`voc`, `clear`...) : ce rôle n'obtient que cette commande, sans hériter
 *     du reste de la hiérarchie ;
 *   - les rôles restants en cascade, dans l'ordre Discord (le plus haut à
 *     l'écran = le rang le plus élevé) ;
 *   - un slot commun tout en haut pour les rôles ayant la permission
 *     Administrateur, qui reçoivent donc tous exactement la même chose.
 *
 * Les rôles gérés par une intégration (`role.managed` : Jockie, Mudae, le bot
 * lui-même...) sont ignorés — ce sont les rôles internes des autres bots.
 */
function buildPlan(guild) {
  const commandNames = new Set(configurableCommandNames());

  const roles = [...guild.roles.cache.values()]
    .filter((r) => r.id !== guild.id)
    .filter((r) => !r.managed)
    .sort((a, b) => a.position - b.position);

  const dedicated = [];
  const admins = [];
  const cascadeRoles = [];

  for (const role of roles) {
    const command = role.name.trim().toLowerCase();
    if (commandNames.has(command)) {
      dedicated.push({ role, command });
    } else if (role.permissions.has(PermissionFlagsBits.Administrator)) {
      admins.push(role);
    } else {
      cascadeRoles.push(role);
    }
  }

  // Une commande qui a son propre rôle (`voc`, `clear`...) sort de la cascade :
  // sinon un rôle plus bas en hériterait et le rôle dédié ne servirait plus à
  // rien. Créer un rôle nommé `voc` est justement le signe qu'on veut réserver
  // cette commande à ses membres. Le slot "Administrateurs", lui, garde tout.
  const reserved = new Set(dedicated.map((d) => d.command));
  const cascadeGroups = CASCADE_GROUPS.map((group) => ({
    ...group,
    commands: group.commands.filter((c) => !reserved.has(c)),
  }));

  const buckets = distribute(cascadeGroups, cascadeRoles.length);
  const slots = cascadeRoles.map((role, i) => ({
    name: role.name,
    roles: [role],
    commands: buckets[i],
    exclusive: false,
  }));

  if (admins.length) {
    slots.push({
      name: "Administrateurs",
      roles: admins,
      commands: [...commandNames],
      exclusive: false,
    });
  }

  for (const { role, command } of dedicated) {
    slots.push({ name: role.name, roles: [role], commands: [command], exclusive: true });
  }

  return { slots, ignored: [...guild.roles.cache.values()].filter((r) => r.managed) };
}

function describe(slot, index) {
  const roles = slot.roles.map((r) => r.name).join(", ");
  const commands = slot.commands.length
    ? slot.commands.length > 12
      ? `${slot.commands.slice(0, 12).join(", ")}… (+${slot.commands.length - 12})`
      : slot.commands.join(", ")
    : "*aucune*";
  return {
    name: `${index + 1}. ${slot.name}${slot.exclusive ? " — exclusif" : ""}`,
    value: `rôles : ${roles}\n> commandes : ${commands}`,
  };
}

module.exports = {
  name: "syncperms",
  category: "sys",
  description: "Reconstruit les slots de permissions à partir de la hiérarchie des rôles du serveur",
  usage: "&syncperms [confirm]",
  level: LEVEL.SYS,
  async execute(ctx) {
    const plan = buildPlan(ctx.guild);

    if (!plan.slots.length) {
      await ctx.reply(ctx.card({ title: "Aucun rôle exploitable", description: "Tous les rôles du serveur sont gérés par une intégration." }));
      return;
    }

    const confirmed = (ctx.args[0] || "").toLowerCase() === "confirm";

    if (!confirmed) {
      const existing = permissionsStore.listByGuild(ctx.guildId).length;
      await ctx.reply(
        ctx.card({
          title: "Plan de synchronisation des permissions",
          description: [
            `**${plan.slots.length}** slots seraient créés, du rang le plus bas au plus haut.`,
            existing ? `⚠️ Les **${existing}** slots existants seraient **supprimés et remplacés**.` : "Aucun slot existant à remplacer.",
            plan.ignored.length ? `${plan.ignored.length} rôles d'intégration ignorés (rôles internes des autres bots).` : "",
            "Les commandes qui bannissent, expulsent ou touchent aux rôles ne sont données qu'aux **Administrateurs**.",
            "",
            "Rien n'a été modifié. Lance `&syncperms confirm` pour appliquer.",
          ]
            .filter(Boolean)
            .join("\n"),
          fields: plan.slots.map(describe),
        })
      );
      return;
    }

    for (const slot of permissionsStore.listByGuild(ctx.guildId)) {
      permissionsStore.remove(ctx.guildId, slot.id);
    }

    for (const entry of plan.slots) {
      const slot = permissionsStore.create(ctx.guildId, entry.name);
      if (entry.exclusive) permissionsStore.setExclusive(ctx.guildId, slot.id, true);
      for (const role of entry.roles) permissionsStore.addRole(ctx.guildId, slot.id, role.id);
      for (const command of entry.commands) permissionsStore.addCommand(ctx.guildId, slot.id, command);
    }

    // Indispensable : sans ça la config ne vivrait que sur le disque du
    // container, réinitialisé à chaque redéploiement Railway. Le panel fait
    // pareil après chaque interaction (voir utils/modPanelRouter.js).
    await saveGuildConfig(ctx.guild, ["permissions"]).catch((err) =>
      console.warn("[syncperms] échec de la sauvegarde de config :", err.message)
    );

    await ctx.reply(
      ctx.card({
        title: "✅ Permissions synchronisées",
        description: `**${plan.slots.length}** slots créés depuis la hiérarchie des rôles. Vérifie avec \`&perms\` ou \`&panel\` > Permissions.`,
        fields: plan.slots.map(describe),
      })
    );
  },
};
