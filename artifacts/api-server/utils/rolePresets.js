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
// rank) ou publiques (snipe, pic, banner, server...) n'ajoutent aucune clé
// PAR ELLES-MÊMES.
//
// Demande explicite : 13 paliers VISUELLEMENT distincts dans &perms/&helpall/
// "Rôles (paliers)", comme la référence fournie — jamais deux paliers groupés
// ensemble. Les listes de commandes d'origine donnaient pourtant le MÊME
// contenu réel à plusieurs paliers de suite (1≈2 vides, 7≈8≈9≈10) une fois
// filtrées des commandes inexistantes ou publiques — et deux rôles aux clés
// strictement identiques s'affichent TOUJOURS groupés, quel que soit leur nom,
// ce système regroupant par permission réellement accordée, pas par étiquette.
// Chaque palier concerné reçoit donc UNE clé supplémentaire choisie parmi les
// permissions du catalogue pas encore utilisées ailleurs dans cette liste
// (outils annexes, rôles automatiques, sondages, giveaways, mode lent) —
// purement pour les séparer visuellement, sans rapport avec les commandes
// d'origine. Cumulatif de bout en bout : chaque palier garde TOUTES les clés
// du précédent, plus au moins une nouvelle (garanti par un test dédié, voir
// scripts/test-role-presets.js).
// `display` : le texte EXACT fourni par l'utilisateur pour ce palier, montré
// tel quel sur &perms (utils/permissions/store.js::setPermsDisplay) à la
// place des commandes RÉELLEMENT débloquées par `keys`. Certains de ces noms
// (absence reset/set, staff check, blrank/bl, rank...) ne correspondent à
// AUCUNE commande de ce bot — assumé, demande explicite de reproduire la
// référence fournie telle quelle plutôt que la liste réelle. `keys` reste ce
// qui détermine le REGROUPEMENT en paliers distincts (voir plus haut) et les
// permissions du bot réellement accordées ; `display` n'affecte que ce qui
// s'affiche sur &perms.
const TIERS = [
  { names: ["Perm I"], keys: ["server.tools.use"], display: "absence reset, absence set, snipe" },
  { names: ["Perm II"], keys: ["server.tools.use", "channels.slowmode"], display: "absence reset, absence set, pic, snipe" },
  {
    names: ["Perm III"],
    keys: ["server.tools.use", "channels.slowmode", "server.info.view"],
    display: "absence reset, absence set, pic, snipe, user",
  },
  {
    names: ["Perm IV"],
    keys: ["server.tools.use", "channels.slowmode", "server.info.view", "server.members.list"],
    display: "absence reset, absence set, find, pic, snipe, user",
  },
  {
    names: ["Perm V", "🎤"],
    keys: ["server.tools.use", "channels.slowmode", "server.info.view", "server.members.list", "logs.view", "moderation.timeout"],
    display: "absence reset, absence set, find, pic, sanctions, snipe, tempmute, user",
  },
  {
    names: ["(GAP/GS)", "✗", "🚩"],
    keys: [
      "server.tools.use", "channels.slowmode", "server.info.view", "server.members.list", "logs.view", "moderation.timeout",
      "members.role", "members.nick", "server.voice.manage",
    ],
    display: "absence reset, absence set, addrole, banner, find, mv, nick, pic, removerole, sanctions, snipe, tempmute, user",
  },
  {
    names: ["Célestial", "🐋", "🦅"],
    keys: [
      "server.tools.use", "channels.slowmode", "server.info.view", "server.members.list", "logs.view", "moderation.timeout",
      "members.role", "members.nick", "server.voice.manage", "server.stats.view",
    ],
    display:
      "absence reset, absence set, addrole, banner, find, mv, nick, pic, removerole, sanctions, serveur banner, serveur pic, snipe, tempmute, user, vc",
  },
  {
    names: ["🎗️", "🌹", "🦋"],
    keys: [
      "server.tools.use", "channels.slowmode", "server.info.view", "server.members.list", "logs.view", "moderation.timeout",
      "members.role", "members.nick", "server.voice.manage", "server.stats.view", "members.autorole.manage",
    ],
    display:
      "absence reset, absence set, addrole, banner, find, mv, nick, pic, removerole, sanctions, serveur banner, serveur pic, snipe, tempmute, user, vc",
  },
  {
    names: ["Kina", "⛪", "🎣"],
    keys: [
      "server.tools.use", "channels.slowmode", "server.info.view", "server.members.list", "logs.view", "moderation.timeout",
      "members.role", "members.nick", "server.voice.manage", "server.stats.view", "members.autorole.manage", "server.polls.manage",
    ],
    display:
      "absence reset, absence set, addrole, banner, derank, find, mv, nick, pic, removerole, sanctions, serveur banner, serveur info, serveur pic, snipe, staff check, tempmute, user, vc",
  },
  {
    names: ["Crown", "Top"],
    keys: [
      "server.tools.use", "channels.slowmode", "server.info.view", "server.members.list", "logs.view", "moderation.timeout",
      "members.role", "members.nick", "server.voice.manage", "server.stats.view", "members.autorole.manage", "server.polls.manage",
      "server.giveaways.manage",
    ],
    display:
      "absence reset, absence set, addrole, banner, derank, find, mv, nick, pic, removerole, sanctions, serveur banner, serveur info, serveur pic, snipe, staff check, tempmute, user, vc",
  },
  {
    names: ["Ordre", "Maître", "BOT=BOT"],
    keys: [
      "server.tools.use", "channels.slowmode", "server.info.view", "server.members.list", "logs.view", "moderation.timeout",
      "members.role", "members.nick", "server.voice.manage", "server.stats.view", "members.autorole.manage", "server.polls.manage",
      "server.giveaways.manage", "moderation.ban", "moderation.unban",
    ],
    display:
      "absence reset, absence set, addrole, ban, baninfo, banlist, banner, blrank add, blrank list, blrank remove, derank, find, mv, nick, pic, removerole, sanctions, serveur banner, serveur info, serveur pic, snipe, staff check, tempmute, user, vc",
  },
  {
    names: ["—", "=", "≡", "♂"],
    keys: [
      "server.tools.use", "channels.slowmode", "server.info.view", "server.members.list", "logs.view", "moderation.timeout",
      "members.role", "members.nick", "server.voice.manage", "server.stats.view", "members.autorole.manage", "server.polls.manage",
      "server.giveaways.manage", "moderation.ban", "moderation.unban", "moderation.clear",
    ],
    display:
      "absence reset, absence set, addrole, ban, baninfo, banlist, banner, bl remove, blrank add, blrank list, blrank remove, clear, derank, find, mv, nick, pic, rank, removerole, rolemembers, sanctions, serveur banner, serveur info, serveur pic, snipe, staff check, tempmute, unban, user, vc",
  },
  {
    names: ["者", "Couronne", "SECURE"],
    keys: [
      "server.tools.use", "channels.slowmode", "server.info.view", "server.members.list", "logs.view", "moderation.timeout",
      "members.role", "members.nick", "server.voice.manage", "server.stats.view", "members.autorole.manage", "server.polls.manage",
      "server.giveaways.manage", "moderation.ban", "moderation.unban", "moderation.clear",
      "moderation.warn", "logs.manage", "server.channels.manage", "channels.manage", "channels.lock", "server.voice.moveall",
    ],
    display:
      "absence reset, absence set, addrole, avert, avertissements, ban, baninfo, banlist, banner, bl add, bl info, bl list, bl remove, blrank add, blrank list, blrank remove, clear, create, derank, embed, find, hide, lock, mv, nick, pic, rank, remove avert, removerole, rolemembers, sanctions, serveur banner, serveur info, serveur pic, snipe, staff check, tempmute, unban, unhide, unlock, user, vc, voicemove",
  },
];

// "Hors hiérarchie" : chacun garde son propre NOM affiché (au lieu d'un bloc
// "Exclusives" générique) — voir utils/permissions/store.js::setRoleExclusive
// et utils/permsCommands.js::buildTierCard.
const EXCLUSIVE = [
  {
    name: "♂",
    label: "Syndicat",
    keys: [
      "members.role", "moderation.warn", "logs.manage", "moderation.ban", "moderation.unban",
      "server.members.list", "moderation.timeout", "server.voice.manage", "members.nick", "logs.view",
      "server.info.view", "server.stats.view",
    ],
    display:
      "addrole, avert, avertissements, ban, baninfo, banlist, blrank add, blrank list, blrank remove, derank, find, mutelist, mv, nick, pic, remove avert, removerole, rolemembers, sanctions, serveur banner, serveur pic, snipe, tempmute, unban, unmute, user, vc",
  },
  {
    name: "🏅",
    label: "Gérant gestion",
    keys: [
      "members.role", "moderation.ban", "moderation.unban", "moderation.clear", "server.members.list",
      "server.voice.manage", "members.nick", "server.info.view", "server.stats.view",
    ],
    display:
      "addrole, ban, baninfo, banlist, bl add, bl info, bl list, bl remove, blrank add, blrank list, blrank remove, clear, derank, find, limitrole, mv, nick, pic, rank, removerole, rolemembers, serveur banner, serveur pic, snipe, staff check, user, vc",
  },
  { name: "(GAP/GS)", label: "(gs/gap)", keys: ["members.role"], display: "addrole, derank" },
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
          permStore.setPermsDisplay(guild.id, role.id, tier.display);
          created++;
        }
      }
      for (const entry of EXCLUSIVE) {
        const role = await guild.roles.create({ name: entry.name, reason: `Rôle hors hiérarchie créé par ${interaction.user.tag}` }).catch(() => null);
        if (!role) continue;
        permStore.setRoleGrants(guild.id, role.id, entry.keys);
        permStore.setRoleExclusive(guild.id, role.id, true, entry.label);
        permStore.setPermsDisplay(guild.id, role.id, entry.display);
        created++;
      }

      // Le rôle géré du bot lui-même (ex: "PROTECT") reçoit les mêmes clés ET
      // le même texte affiché que le palier le plus haut, pour qu'il se
      // retrouve groupé AVEC "Permission 13" dans &perms/&helpall/"Rôles
      // (paliers)" — demande explicite, plutôt qu'une rubrique "Bot" séparée.
      // Il reste de toute façon toujours au-dessus de tout le reste dans la
      // hiérarchie Discord (un bot ne peut pas créer de rôle plus haut que le
      // sien).
      const botRole = guild.members.me?.roles.botRole;
      if (botRole) {
        const dernierPalier = TIERS[TIERS.length - 1];
        permStore.setRoleGrants(guild.id, botRole.id, dernierPalier.keys);
        permStore.setPermsDisplay(guild.id, botRole.id, dernierPalier.display);
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

module.exports = { createPresetRoles, deleteAllRoles, TOTAL_ROLES, TIERS, EXCLUSIVE };
