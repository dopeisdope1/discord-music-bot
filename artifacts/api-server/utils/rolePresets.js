const { PermissionFlagsBits } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const { checkBotPermission, report } = require("./moderation/actions");
const { requestConfirmation } = require("./serverAdminCommands");
const levelStore = require("./permissions/levelStore");

// Hiérarchie de rôles prédéfinis : 13 paliers nommés + 3 rôles autrefois
// "hors hiérarchie" (Syndicat, Gérant gestion, (GAP/GS)) — conservés TELS
// QUELS (mêmes 16 noms créés), mais désormais assignés à un NIVEAU (1-9,
// utils/permissions/levelStore.js) au lieu d'un ensemble de clés propre à
// chacun. Avec seulement 9 niveaux pour 16 rôles, plusieurs rôles partagent
// nécessairement le même niveau — assumé, demande explicite : garder tous
// les noms plutôt que d'en fusionner ou retirer. La correspondance ci-dessous
// respecte l'ordre croissant d'origine (paliers les plus bas -> niveau 1,
// les plus hauts -> niveau 9), "hors hiérarchie" répartis selon leur ampleur
// réelle (Syndicat et Gérant gestion avaient des droits comparables aux
// paliers du milieu, (GAP/GS) à un palier bas).
const TIERS = [
  { names: ["Perm I"], level: 1 },
  { names: ["Perm II"], level: 1 },
  { names: ["Perm III"], level: 2 },
  { names: ["Perm IV"], level: 2 },
  { names: ["Perm V", "🎤"], level: 3 },
  { names: ["(GAP/GS)", "✗", "🚩"], level: 4 },
  { names: ["Célestial", "🐋", "🦅"], level: 4 },
  { names: ["🎗️", "🌹", "🦋"], level: 5 },
  { names: ["Kina", "⛪", "🎣"], level: 5 },
  { names: ["Crown", "Top"], level: 6 },
  { names: ["Ordre", "Maître", "BOT=BOT"], level: 6 },
  { names: ["—", "=", "≡", "♂"], level: 7 },
  { names: ["者", "Couronne", "SECURE"], level: 9 },
];

// Autrefois "hors hiérarchie" (utils/permissions/store.js::setRoleExclusive,
// retiré avec le passage aux niveaux) : ces 3 rôles restent créés comme les
// autres, simplement assignés à un niveau comme n'importe quel rôle.
const EXCLUSIVE = [
  { name: "♂", label: "Syndicat", level: 5 },
  { name: "🏅", label: "Gérant gestion", level: 4 },
  { name: "(GAP/GS)", label: "(gs/gap)", level: 1 },
];

const TOTAL_ROLES = TIERS.reduce((n, t) => n + t.names.length, 0) + EXCLUSIVE.length;

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text, { guildId: message.guild.id })] });

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
    execute: async (interaction, terminer) => {
      const guild = interaction.guild;
      let created = 0;

      // Du palier le plus haut vers le plus bas : les rôles créés en dernier
      // remontent en haut de la liste Discord, donc l'ordre final va du plus
      // haut niveau (haut de liste) au plus bas — hiérarchie visuelle intuitive.
      for (let i = TIERS.length - 1; i >= 0; i--) {
        const tier = TIERS[i];
        for (const name of tier.names) {
          const role = await guild.roles.create({ name, reason: `Rôles prédéfinis créés par ${interaction.user.tag}` }).catch(() => null);
          if (!role) continue;
          levelStore.setRoleLevel(guild.id, role.id, tier.level);
          created++;
        }
      }
      for (const entry of EXCLUSIVE) {
        const role = await guild.roles.create({ name: entry.name, reason: `Rôle prédéfini créé par ${interaction.user.tag}` }).catch(() => null);
        if (!role) continue;
        levelStore.setRoleLevel(guild.id, role.id, entry.level);
        created++;
      }

      // Le rôle géré du bot lui-même (ex: "PROTECT") reçoit le niveau le plus
      // haut, pour qu'il se retrouve groupé avec le palier le plus élevé dans
      // &perms/&helpall/"Rôles (niveaux)" — demande explicite, plutôt qu'une
      // rubrique "Bot" séparée. Il reste de toute façon toujours au-dessus de
      // tout le reste dans la hiérarchie Discord (un bot ne peut pas créer de
      // rôle plus haut que le sien).
      const botRole = guild.members.me?.roles.botRole;
      if (botRole) {
        const dernierPalier = TIERS[TIERS.length - 1];
        levelStore.setRoleLevel(guild.id, botRole.id, dernierPalier.level);
      }

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

      return terminer("Terminé", `**${created}** rôle(s) créé(s) sur ${TOTAL_ROLES} — voir la rubrique "Rôles (paliers)" pour les retrouver.`);
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
    execute: async (interaction, terminer) => {
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

      return terminer("Terminé", `**${deleted}** rôle(s) supprimé(s).`);
    },
  });
}

module.exports = { createPresetRoles, deleteAllRoles, TOTAL_ROLES, TIERS, EXCLUSIVE };
