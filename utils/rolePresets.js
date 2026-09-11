const { PermissionFlagsBits } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const { checkBotPermission, report } = require("./moderation/actions");
const { requestConfirmation } = require("./serverAdminCommands");
const { card } = require("./listCard");
const permStore = require("./permissions/store");

// Refonte demandée de la hiérarchie des rôles : 13 paliers numérotés
// (calqués sur les commandes réellement accordées à chaque palier — voir la
// discussion) + 3 rôles "hors hiérarchie" marqués EXCLUSIFS (jamais mélangés
// à un palier numéroté, voir utils/permsCommands.js::computeTiers). Les
// commandes demandées mais pas construites (absence, staff check, blrank/bl,
// rank) ou publiques (snipe, pic, banner, server...) n'ajoutent aucune clé.
//
// Plusieurs paliers finissent avec le MÊME ensemble de clés une fois filtrés
// des commandes inexistantes (7≈8, 9≈10) : ils s'afficheront donc regroupés
// dans &perms/&helpall/la rubrique "Rôles (paliers)", même si les rôles
// eux-mêmes restent bien créés séparément sous leur propre nom.
const TIERS = [
  { names: ["Perm I"], keys: [] },
  { names: ["Perm II"], keys: [] },
  { names: ["Perm III"], keys: ["server.info.view"] },
  { names: ["Perm IV"], keys: ["server.info.view", "server.members.list"] },
  { names: ["Perm V", "🎤"], keys: ["server.info.view", "server.members.list", "logs.view", "moderation.timeout"] },
  {
    names: ["(GAP/GS)", "✗", "🚩"],
    keys: ["server.info.view", "server.members.list", "logs.view", "moderation.timeout", "members.role", "members.nick", "server.voice.manage"],
  },
  {
    names: ["Célestial", "🐋", "🦅"],
    keys: ["server.info.view", "server.members.list", "logs.view", "moderation.timeout", "members.role", "members.nick", "server.voice.manage", "server.stats.view"],
  },
  {
    names: ["🎗️", "🌹", "🦋"],
    keys: ["server.info.view", "server.members.list", "logs.view", "moderation.timeout", "members.role", "members.nick", "server.voice.manage", "server.stats.view"],
  },
  {
    names: ["Kina", "⛪", "🎣"],
    keys: ["server.info.view", "server.members.list", "logs.view", "moderation.timeout", "members.role", "members.nick", "server.voice.manage", "server.stats.view"],
  },
  {
    names: ["Crown", "Top"],
    keys: ["server.info.view", "server.members.list", "logs.view", "moderation.timeout", "members.role", "members.nick", "server.voice.manage", "server.stats.view"],
  },
  {
    names: ["Ordre", "Maître", "BOT=BOT"],
    keys: [
      "server.info.view", "server.members.list", "logs.view", "moderation.timeout", "members.role", "members.nick",
      "server.voice.manage", "server.stats.view", "moderation.ban", "moderation.unban",
    ],
  },
  {
    names: ["—", "=", "≡", "♂"],
    keys: [
      "server.info.view", "server.members.list", "logs.view", "moderation.timeout", "members.role", "members.nick",
      "server.voice.manage", "server.stats.view", "moderation.ban", "moderation.unban", "moderation.clear",
    ],
  },
  {
    names: ["者", "Couronne", "SECURE"],
    keys: [
      "server.info.view", "server.members.list", "logs.view", "moderation.timeout", "members.role", "members.nick",
      "server.voice.manage", "server.stats.view", "moderation.ban", "moderation.unban", "moderation.clear",
      "moderation.warn", "logs.manage", "server.channels.manage", "channels.manage", "channels.lock", "server.voice.moveall",
    ],
  },
];

const EXCLUSIVE = [
  {
    name: "♂",
    keys: [
      "members.role", "moderation.warn", "logs.manage", "moderation.ban", "moderation.unban",
      "server.members.list", "moderation.timeout", "server.voice.manage", "members.nick", "logs.view",
      "server.info.view", "server.stats.view",
    ],
  },
  {
    name: "🏅",
    keys: [
      "members.role", "moderation.ban", "moderation.unban", "moderation.clear", "server.members.list",
      "server.voice.manage", "members.nick", "server.info.view", "server.stats.view",
    ],
  },
  { name: "(GAP/GS)", keys: ["members.role"] },
];

const TOTAL_ROLES = TIERS.reduce((n, t) => n + t.names.length, 0) + EXCLUSIVE.length;

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });

/** Depuis le panel (rubrique "Rôles (paliers)") : crée les 33 rôles prédéfinis, avec leurs permissions déjà réglées. */
async function createPresetRoles(client, message) {
  if (!can(message.member, "sys")) return;
  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
  if (botPerm) return reply(message, "error", botPerm);

  return requestConfirmation(message, {
    title: `Créer les ${TOTAL_ROLES} rôles prédéfinis ?`,
    body: `**${TOTAL_ROLES}** rôles seront créés (13 paliers de permissions + 3 rôles hors hiérarchie), chacun avec les permissions du bot déjà réglées d'après les commandes prévues pour ce palier.`,
    confirmLabel: "Créer",
    permission: "sys",
    execute: async (interaction) => {
      const guild = interaction.guild;
      let created = 0;

      // Du palier 13 vers le 1 : les rôles créés en dernier remontent en haut
      // de la liste Discord, donc l'ordre final va du plus haut palier (haut
      // de liste) au plus bas — hiérarchie visuelle intuitive.
      for (let i = TIERS.length - 1; i >= 0; i--) {
        const tier = TIERS[i];
        for (const name of tier.names) {
          const role = await guild.roles.create({ name, reason: `Rôles prédéfinis créés par ${interaction.user.tag}` }).catch(() => null);
          if (!role) continue;
          if (tier.keys.length) permStore.setRoleGrants(guild.id, role.id, tier.keys);
          created++;
        }
      }
      for (const entry of EXCLUSIVE) {
        const role = await guild.roles.create({ name: entry.name, reason: `Rôle hors hiérarchie créé par ${interaction.user.tag}` }).catch(() => null);
        if (!role) continue;
        permStore.setRoleGrants(guild.id, role.id, entry.keys);
        permStore.setRoleExclusive(guild.id, role.id, true);
        created++;
      }

      // Le rôle géré du bot lui-même (ex: "PROTECT") reçoit les mêmes clés que
      // le palier le plus haut, pour qu'il se retrouve groupé AVEC "Permission
      // 13" dans &perms/&helpall/"Rôles (paliers)" — demande explicite, plutôt
      // qu'une rubrique "Bot" séparée. Il reste de toute façon toujours au-
      // dessus de tout le reste dans la hiérarchie Discord (un bot ne peut pas
      // créer de rôle plus haut que le sien).
      const botRole = guild.members.me?.roles.botRole;
      if (botRole) permStore.setRoleGrants(guild.id, botRole.id, TIERS[TIERS.length - 1].keys);

      await report(interaction.client, {
        guildId: guild.id,
        category: "server",
        title: "Rôles prédéfinis créés",
        fields: [{ label: "Rôles créés", value: `${created}/${TOTAL_ROLES}` }],
        action: "role_presets_create",
        targetId: guild.id,
        targetTag: null,
        moderator: interaction.user,
        channelId: null,
      });

      return interaction.update(card("Terminé", `**${created}** rôle(s) créé(s) sur ${TOTAL_ROLES} — voir la rubrique "Rôles (paliers)" pour les retrouver.`));
    },
  });
}

/** Depuis le panel : supprime TOUS les rôles du serveur (sauf @everyone et les rôles gérés par une intégration). */
async function deleteAllRoles(client, message) {
  if (!can(message.member, "sys")) return;
  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageRoles, "ManageRoles");
  if (botPerm) return reply(message, "error", botPerm);

  const guild = message.guild;
  const deletable = [...guild.roles.cache.values()].filter((r) => r.id !== guild.id && !r.managed);
  if (!deletable.length) return reply(message, "info", "Aucun rôle à supprimer.");

  const apercu = deletable.slice(0, 20).map((r) => r.name).join(", ") + (deletable.length > 20 ? `, +${deletable.length - 20} autre(s)` : "");

  return requestConfirmation(message, {
    title: `Supprimer TOUS les rôles (${deletable.length}) ?`,
    body: `**${deletable.length}** rôle(s) seront supprimés définitivement : ${apercu}\n\nLes permissions déjà accordées à ces rôles restent enregistrées mais n'ont plus d'effet, le rôle n'existant plus.\n\nCette action est définitive et ne peut pas être annulée.`,
    confirmLabel: "Supprimer tout",
    permission: "sys",
    execute: async (interaction) => {
      // Relu au moment du clic : la liste a pu changer entre l'ouverture de
      // la confirmation et le clic sur "Supprimer tout".
      const fresh = [...interaction.guild.roles.cache.values()].filter((r) => r.id !== interaction.guild.id && !r.managed);
      let deleted = 0;
      for (const role of fresh) {
        const ok = await role.delete(`Suppression en masse par ${interaction.user.tag}`).then(
          () => true,
          () => false
        );
        if (ok) deleted++;
      }

      await report(interaction.client, {
        guildId: interaction.guild.id,
        category: "server",
        title: "Tous les rôles supprimés",
        fields: [{ label: "Rôles supprimés", value: `${deleted}/${fresh.length}` }],
        action: "role_presets_delete_all",
        targetId: interaction.guild.id,
        targetTag: null,
        moderator: interaction.user,
        channelId: null,
      });

      return interaction.update(card("Terminé", `**${deleted}** rôle(s) supprimé(s).`));
    },
  });
}

module.exports = { createPresetRoles, deleteAllRoles, TOTAL_ROLES, TIERS };
