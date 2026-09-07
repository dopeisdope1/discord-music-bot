const {
  MessageFlags,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  MentionableSelectMenuBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelType,
} = require("discord.js");
const { can } = require("./permissions/engine");
const { EMOJI } = require("./emojis");
const { startGiveaway, rerollGiveaway, endGiveaway, MAX_WINNERS } = require("./giveaways");
const { createPoll } = require("./polls");
const { setupTickets } = require("./tickets");
const { moderationHandlers } = require("./moderationCommands");
const moderationExtra = require("./moderationExtra");
const { channelHandlers } = require("./channelCommands");
const { handleBan, handleUnban } = require("./banPanel");
const serverAdmin = require("./serverAdminCommands");
const serverExtra = require("./serverExtra");
const botProfileCommands = require("./botProfileCommands");
const { automodHandlers } = require("./automodCommands");
const { configHandlers } = require("./configCommands");
const permCatalog = require("./permissions/catalog");
const { autoroleHandlers } = require("./autoroleCommands");
const { fakeMessage, remplacerParLaReponse, aEteRemplace } = require("./fakeMessage");

// Exécution de commandes directement depuis le panel (&panel > Exécuter) :
// pas une deuxième logique — chaque `run` construit un faux "message" à
// partir des choix (salon/rôle/membre/texte) et appelle le VRAI handler
// texte existant, tel quel (mêmes vérifications de permission/hiérarchie,
// même journalisation). Demande explicite : "les boutons du panel doivent
// appeler les mêmes fonctions que les commandes existantes".
//
// Périmètre volontairement progressif (6 commandes pour l'instant, une par
// famille de champs) plutôt qu'une tentative ratée sur les ~400 commandes
// du catalogue — la plupart n'ont d'ailleurs aucun backend à appeler (voir
// utils/commandCatalog.js). Complété au fil des prochaines commandes qui
// gagnent un vrai backend.

/**
 * Construit le faux message pour un champ "mentionable" déjà résolu (rôle OU
 * membre, voir extractFormValues/handleFormCardInteraction) — factorisé car
 * utilisé par plusieurs formulaires (set_perm_grant, del_perm_grant).
 * @returns {Promise<object|null>} null si la cible n'existe plus (réponse
 *   d'erreur déjà envoyée dans ce cas).
 */
async function resolveMentionableMessage(interaction, v) {
  if (v.mentionableType === "role") {
    const role = interaction.guild.roles.cache.get(v.mentionableId);
    if (!role) {
      await interaction.followUp({ content: "Rôle introuvable.", flags: MessageFlags.Ephemeral });
      return null;
    }
    return fakeMessage(interaction, { role });
  }
  const member = await interaction.guild.members.fetch(v.mentionableId).catch(() => null);
  if (!member) {
    await interaction.followUp({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
    return null;
  }
  return fakeMessage(interaction, { user: member });
}

const CATEGORIES = {
  moderation: "Modération",
  channels: "Salons",
  server: "Gestion du serveur",
  voice: "Vocal",
  botcontrol: "Contrôle du bot",
  protection: "Protection",
};

const FORMS = {
  giveaway_start: {
    label: "Lancer un giveaway",
    category: "server",
    permission: "server.giveaways.manage",
    emoji: EMOJI.CROWN,
    fields: ["channel", "role"],
    // Le rôle ne désigne pas la cible de l'action ici, mais qui a le DROIT de
    // participer — et il reste facultatif.
    fieldLabels: { role: "Rôle requis pour participer (optionnel)" },
    optionalFields: ["role"],
    choiceFields: [
      {
        key: "duration",
        label: "Durée",
        placeholder: "Choisir une durée",
        customLabel: "Autre durée (à écrire)",
        customPrompt: "Durée personnalisée (ex : 45m, 2h, 5d — max 28 jours)",
        max: 20,
        // Valeurs directement lisibles par parseDuration (utils/moderationCommands.js).
        options: [
          { label: "1 minute", value: "1m" },
          { label: "5 minutes", value: "5m" },
          { label: "15 minutes", value: "15m" },
          { label: "30 minutes", value: "30m" },
          { label: "1 heure", value: "1h" },
          { label: "6 heures", value: "6h" },
          { label: "12 heures", value: "12h" },
          { label: "1 jour", value: "1d" },
          { label: "3 jours", value: "3d" },
          { label: "7 jours", value: "7d" },
        ],
      },
      {
        key: "prize",
        label: "Lot",
        placeholder: "Choisir un lot",
        customLabel: "Autre lot (à écrire)",
        customPrompt: "Lot personnalisé",
        max: 200,
        options: [
          { label: "Nitro (1 mois)", value: "Nitro (1 mois)" },
          { label: "Nitro Basic (1 mois)", value: "Nitro Basic (1 mois)" },
          { label: "Un boost de serveur", value: "Un boost de serveur" },
          { label: "Rôle personnalisé", value: "Rôle personnalisé" },
          { label: "Carte cadeau", value: "Carte cadeau" },
        ],
      },
      {
        key: "winners",
        label: "Nombre de gagnants",
        placeholder: "Nombre de gagnants (1 par défaut)",
        customLabel: "Autre nombre (à écrire)",
        customPrompt: `Nombre de gagnants (1 à ${MAX_WINNERS})`,
        max: 2,
        required: false,
        options: Array.from({ length: 10 }, (_, i) => ({
          label: `${i + 1} gagnant${i ? "s" : ""}`,
          value: String(i + 1),
        })),
      },
    ],
    // Le nombre de gagnants et le rôle ont des valeurs par défaut utilisables :
    // seuls le salon, la durée et le lot bloquent réellement le lancement.
    ready: (v) => Boolean(v.channelId && v.text?.duration && v.text?.prize),
    run: async (client, interaction, v) => {
      const channel = interaction.guild.channels.cache.get(v.channelId);
      const msg = fakeMessage(interaction, { channel });
      await startGiveaway(client, msg, [v.text.duration, v.text.prize], {
        winnersCount: parseInt(v.text.winners, 10) || 1,
        requiredRoleId: v.roleId || null,
      });
    },
  },

  poll_create: {
    label: "Créer un sondage",
    category: "server",
    permission: "server.polls.manage",
    emoji: EMOJI.PENCIL,
    fields: ["channel"],
    textFields: [
      { key: "question", label: "Question", max: 200 },
      { key: "option1", label: "Option 1", max: 80 },
      { key: "option2", label: "Option 2", max: 80 },
      { key: "option3", label: "Option 3 (optionnel)", max: 80, required: false },
    ],
    ready: (v) => Boolean(v.channelId && v.text?.question && v.text?.option1 && v.text?.option2),
    run: async (client, interaction, v) => {
      const channel = interaction.guild.channels.cache.get(v.channelId);
      const parts = [v.text.question, v.text.option1, v.text.option2, v.text.option3].filter(Boolean);
      const argsStr = parts.map((p) => `"${p}"`).join(" ");
      const msg = fakeMessage(interaction, { channel });
      await createPoll(client, msg, [argsStr]);
    },
  },

  ticket_setup: {
    label: "Configurer les tickets",
    category: "server",
    permission: "server.tickets.manage",
    emoji: EMOJI.TICKET,
    fields: ["channel", "role"],
    ready: (v) => Boolean(v.channelId),
    run: async (client, interaction, v) => {
      const channel = interaction.guild.channels.cache.get(v.channelId);
      const role = v.roleId ? interaction.guild.roles.cache.get(v.roleId) : null;
      const msg = fakeMessage(interaction, { channel, role });
      await setupTickets(client, msg, []);
    },
  },

  kick_member: {
    label: "Expulser un membre",
    category: "moderation",
    permission: "moderation.kick",
    emoji: EMOJI.KICK,
    fields: ["user"],
    textFields: [{ key: "reason", label: "Raison (optionnel)", max: 200, required: false }],
    ready: (v) => Boolean(v.userId),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      if (!member) return interaction.followUp({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member });
      await moderationHandlers.kick(client, msg, v.text?.reason ? [v.text.reason] : []);
    },
  },

  timeout_member: {
    label: "Timeout un membre",
    category: "moderation",
    permission: "moderation.timeout",
    emoji: EMOJI.MUTE,
    fields: ["user"],
    textFields: [
      { key: "duration", label: "Durée (ex : 10m, 1h, 1d)", max: 20 },
      { key: "reason", label: "Raison (optionnel)", max: 200, required: false },
    ],
    ready: (v) => Boolean(v.userId && v.text?.duration),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      if (!member) return interaction.followUp({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member });
      const args = [v.text.duration, ...(v.text.reason ? [v.text.reason] : [])];
      await moderationHandlers.timeout(client, msg, args);
    },
  },

  role_create: {
    label: "Créer un rôle",
    category: "server",
    permission: "server.roles.manage",
    emoji: EMOJI.PENCIL,
    fields: [],
    textFields: [{ key: "name", label: "Nom du rôle", max: 100 }],
    ready: (v) => Boolean(v.text?.name),
    run: async (client, interaction, v) => {
      const msg = fakeMessage(interaction, {});
      await serverAdmin.roleAdmin(client, msg, ["create", ...v.text.name.split(/\s+/)]);
    },
  },

  ban_member: {
    label: "Bannir un membre",
    category: "moderation",
    permission: "moderation.ban",
    emoji: EMOJI.BAN,
    fields: ["user"],
    textFields: [{ key: "reason", label: "Raison (optionnel)", max: 200, required: false }],
    ready: (v) => Boolean(v.userId),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      if (!member) return interaction.followUp({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member });
      await handleBan(client, msg, v.text?.reason ? [v.text.reason] : []);
    },
  },

  softban_member: {
    label: "Softban un membre",
    category: "moderation",
    permission: "moderation.softban",
    emoji: EMOJI.BAN,
    fields: ["user"],
    textFields: [{ key: "reason", label: "Raison (optionnel)", max: 200, required: false }],
    ready: (v) => Boolean(v.userId),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      if (!member) return interaction.followUp({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member });
      await moderationHandlers.softban(client, msg, v.text?.reason ? [v.text.reason] : []);
    },
  },

  unban_id: {
    label: "Débannir (par ID)",
    category: "moderation",
    permission: "moderation.unban",
    emoji: EMOJI.CHECK,
    fields: [],
    textFields: [{ key: "id", label: "Identifiant Discord du membre banni", max: 25 }],
    ready: (v) => Boolean(v.text?.id),
    run: async (client, interaction, v) => {
      const msg = fakeMessage(interaction, {});
      await handleUnban(client, msg, [v.text.id]);
    },
  },

  addrole_member: {
    label: "Ajouter un rôle à un membre",
    category: "moderation",
    permission: "members.role",
    emoji: EMOJI.CHECK,
    fields: ["user", "role"],
    ready: (v) => Boolean(v.userId && v.roleId),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      const role = interaction.guild.roles.cache.get(v.roleId);
      if (!member || !role) return interaction.followUp({ content: "Membre ou rôle introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member, role });
      await moderationHandlers.addrole(client, msg, []);
    },
  },

  delrole_member: {
    label: "Retirer un rôle à un membre",
    category: "moderation",
    permission: "members.role",
    emoji: EMOJI.CROSS,
    fields: ["user", "role"],
    ready: (v) => Boolean(v.userId && v.roleId),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      const role = interaction.guild.roles.cache.get(v.roleId);
      if (!member || !role) return interaction.followUp({ content: "Membre ou rôle introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member, role });
      await moderationHandlers.delrole(client, msg, []);
    },
  },

  lock_channel: {
    label: "Verrouiller un salon",
    category: "channels",
    permission: "channels.lock",
    fields: ["channel"],
    ready: (v) => Boolean(v.channelId),
    run: async (client, interaction, v) => {
      const channel = interaction.guild.channels.cache.get(v.channelId);
      if (!channel) return interaction.followUp({ content: "Salon introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { channel });
      await channelHandlers.lock(client, msg);
    },
  },

  unlock_channel: {
    label: "Déverrouiller un salon",
    category: "channels",
    permission: "channels.lock",
    fields: ["channel"],
    ready: (v) => Boolean(v.channelId),
    run: async (client, interaction, v) => {
      const channel = interaction.guild.channels.cache.get(v.channelId);
      if (!channel) return interaction.followUp({ content: "Salon introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { channel });
      await channelHandlers.unlock(client, msg);
    },
  },

  slowmode_channel: {
    label: "Régler le mode lent d'un salon",
    category: "channels",
    permission: "channels.slowmode",
    fields: ["channel"],
    textFields: [{ key: "duration", label: "Durée (ex : 5s, 1m, off)", max: 10 }],
    ready: (v) => Boolean(v.channelId && v.text?.duration),
    run: async (client, interaction, v) => {
      const channel = interaction.guild.channels.cache.get(v.channelId);
      if (!channel) return interaction.followUp({ content: "Salon introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { channel });
      await moderationHandlers.slowmode(client, msg, [v.text.duration]);
    },
  },

  mute_member: {
    label: "Mute un membre",
    category: "moderation",
    permission: "moderation.timeout",
    emoji: EMOJI.MUTE,
    fields: ["user"],
    textFields: [{ key: "reason", label: "Raison (optionnel)", max: 200, required: false }],
    ready: (v) => Boolean(v.userId),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      if (!member) return interaction.followUp({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member });
      // utils/moderationExtra.js lit la cible directement depuis args[0]
      // (mention ou ID littéral), pas depuis message.mentions — voir sa
      // propre parseTarget(), volontairement plus stricte (fix &clear).
      await moderationExtra.mute(client, msg, [member.id, ...(v.text?.reason ? [v.text.reason] : [])]);
    },
  },

  derank_member: {
    label: "Derank un membre (retire tous ses rôles)",
    category: "moderation",
    permission: "members.role",
    emoji: EMOJI.DELETE,
    fields: ["user"],
    ready: (v) => Boolean(v.userId),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      if (!member) return interaction.followUp({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member });
      await moderationExtra.derank(client, msg, [member.id]);
    },
  },

  untimeout_member: {
    label: "Lever un timeout",
    category: "moderation",
    permission: "moderation.timeout",
    emoji: EMOJI.UNMUTE,
    fields: ["user"],
    ready: (v) => Boolean(v.userId),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      if (!member) return interaction.followUp({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member });
      await moderationHandlers.untimeout(client, msg, []);
    },
  },

  unmute_member: {
    label: "Lever un mute",
    category: "moderation",
    permission: "moderation.timeout",
    emoji: EMOJI.UNMUTE,
    fields: ["user"],
    ready: (v) => Boolean(v.userId),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      if (!member) return interaction.followUp({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member });
      await moderationExtra.unmute(client, msg, [member.id]);
    },
  },

  tempmute_member: {
    label: "Tempmute un membre",
    category: "moderation",
    permission: "moderation.timeout",
    emoji: EMOJI.MUTE,
    fields: ["user"],
    textFields: [
      { key: "duration", label: "Durée (ex : 10m, 1h, 1d)", max: 20 },
      { key: "reason", label: "Raison (optionnel)", max: 200, required: false },
    ],
    ready: (v) => Boolean(v.userId && v.text?.duration),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      if (!member) return interaction.followUp({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member });
      await moderationExtra.tempmute(client, msg, [member.id, v.text.duration, ...(v.text.reason ? [v.text.reason] : [])]);
    },
  },

  tempban_member: {
    label: "Tempban un membre",
    category: "moderation",
    permission: "moderation.ban",
    emoji: EMOJI.BAN,
    fields: ["user"],
    textFields: [
      { key: "duration", label: "Durée (ex : 1d, 12h, 1w)", max: 20 },
      { key: "reason", label: "Raison (optionnel)", max: 200, required: false },
    ],
    ready: (v) => Boolean(v.userId && v.text?.duration),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      if (!member) return interaction.followUp({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member });
      await moderationExtra.tempban(client, msg, [member.id, v.text.duration, ...(v.text.reason ? [v.text.reason] : [])]);
    },
  },

  mutelist_view: {
    label: "Voir la liste des membres mute",
    category: "moderation",
    permission: "moderation.timeout",
    fields: [],
    ready: () => true,
    run: async (client, interaction) => {
      const msg = fakeMessage(interaction, {});
      await moderationExtra.mutelist(client, msg);
    },
  },

  unmuteall_action: {
    label: "Démute tout le monde",
    category: "moderation",
    permission: "moderation.unmuteall",
    fields: [],
    ready: () => true,
    run: async (client, interaction) => {
      const msg = fakeMessage(interaction, {});
      await moderationExtra.unmuteall(client, msg);
    },
  },

  banlist_view: {
    label: "Voir la liste des bannis",
    category: "moderation",
    permission: "moderation.unban",
    fields: [],
    ready: () => true,
    run: async (client, interaction) => {
      const msg = fakeMessage(interaction, {});
      await moderationExtra.banlist(client, msg);
    },
  },

  sanctions_view: {
    label: "Voir les sanctions d'un membre",
    category: "moderation",
    permission: "logs.view",
    fields: ["user"],
    ready: (v) => Boolean(v.userId),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      if (!member) return interaction.followUp({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member });
      await moderationExtra.sanctions(client, msg, [member.id]);
    },
  },

  clear_sanctions_member: {
    label: "Supprimer les sanctions d'un membre",
    category: "moderation",
    permission: "logs.manage",
    fields: ["user"],
    ready: (v) => Boolean(v.userId),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      if (!member) return interaction.followUp({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member });
      await moderationExtra.clearSanctions(client, msg, [member.id]);
    },
  },

  hideall_action: {
    label: "Masquer tous les salons",
    category: "moderation",
    permission: "channels.manageall",
    fields: [],
    ready: () => true,
    run: async (client, interaction) => {
      const msg = fakeMessage(interaction, {});
      await moderationExtra.hideall(client, msg);
    },
  },

  unhideall_action: {
    label: "Réafficher tous les salons",
    category: "moderation",
    permission: "channels.manageall",
    fields: [],
    ready: () => true,
    run: async (client, interaction) => {
      const msg = fakeMessage(interaction, {});
      await moderationExtra.unhideall(client, msg);
    },
  },

  channel_delete: {
    label: "Supprimer un salon",
    category: "channels",
    permission: "server.channels.manage",
    fields: ["channel"],
    ready: (v) => Boolean(v.channelId),
    run: async (client, interaction, v) => {
      const channel = interaction.guild.channels.cache.get(v.channelId);
      if (!channel) return interaction.followUp({ content: "Salon introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { channels: [channel] });
      await serverAdmin.channelAdmin(client, msg, ["delete"]);
    },
  },

  channel_rename: {
    label: "Renommer un salon",
    category: "channels",
    permission: "server.channels.manage",
    fields: ["channel"],
    textFields: [{ key: "name", label: "Nouveau nom", max: 100 }],
    ready: (v) => Boolean(v.channelId && v.text?.name),
    run: async (client, interaction, v) => {
      const channel = interaction.guild.channels.cache.get(v.channelId);
      if (!channel) return interaction.followUp({ content: "Salon introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { channels: [channel] });
      await serverAdmin.channelAdmin(client, msg, ["rename", ...v.text.name.split(/\s+/)]);
    },
  },

  channel_topic: {
    label: "Changer le topic d'un salon",
    category: "channels",
    permission: "server.channels.manage",
    fields: ["channel"],
    textFields: [{ key: "topic", label: "Nouveau topic", max: 200 }],
    ready: (v) => Boolean(v.channelId && v.text?.topic),
    run: async (client, interaction, v) => {
      const channel = interaction.guild.channels.cache.get(v.channelId);
      if (!channel) return interaction.followUp({ content: "Salon introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { channels: [channel] });
      await serverAdmin.channelAdmin(client, msg, ["topic", ...v.text.topic.split(/\s+/)]);
    },
  },

  role_delete: {
    label: "Supprimer un rôle",
    category: "server",
    permission: "server.roles.manage",
    fields: ["role"],
    ready: (v) => Boolean(v.roleId),
    run: async (client, interaction, v) => {
      const role = interaction.guild.roles.cache.get(v.roleId);
      if (!role) return interaction.followUp({ content: "Rôle introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { role });
      await serverAdmin.roleAdmin(client, msg, ["delete"]);
    },
  },

  role_rename: {
    label: "Renommer un rôle",
    category: "server",
    permission: "server.roles.manage",
    fields: ["role"],
    textFields: [{ key: "name", label: "Nouveau nom", max: 100 }],
    ready: (v) => Boolean(v.roleId && v.text?.name),
    run: async (client, interaction, v) => {
      const role = interaction.guild.roles.cache.get(v.roleId);
      if (!role) return interaction.followUp({ content: "Rôle introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { role });
      await serverAdmin.roleAdmin(client, msg, ["rename", ...v.text.name.split(/\s+/)]);
    },
  },

  role_color: {
    label: "Changer la couleur d'un rôle",
    category: "server",
    permission: "server.roles.manage",
    fields: ["role"],
    textFields: [{ key: "hex", label: "Couleur hex (ex : #5865F2)", max: 7 }],
    ready: (v) => Boolean(v.roleId && v.text?.hex),
    run: async (client, interaction, v) => {
      const role = interaction.guild.roles.cache.get(v.roleId);
      if (!role) return interaction.followUp({ content: "Rôle introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { role });
      await serverAdmin.roleAdmin(client, msg, ["color", v.text.hex]);
    },
  },

  dero_role: {
    label: "Ajouter/retirer un rôle du dero automatique",
    category: "server",
    permission: "server.dero.manage",
    fields: ["role"],
    ready: (v) => Boolean(v.roleId),
    run: async (client, interaction, v) => {
      const role = interaction.guild.roles.cache.get(v.roleId);
      if (!role) return interaction.followUp({ content: "Rôle introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { role });
      await serverAdmin.dero(client, msg, ["role"]);
    },
  },

  giveaway_reroll: {
    label: "Retirer un gagnant (reroll)",
    category: "server",
    permission: "server.giveaways.manage",
    fields: [],
    textFields: [{ key: "id", label: "ID du giveaway (optionnel, sinon le dernier)", max: 30, required: false }],
    ready: () => true,
    run: async (client, interaction, v) => {
      const msg = fakeMessage(interaction, {});
      await rerollGiveaway(client, msg, v.text?.id ? [v.text.id] : []);
    },
  },

  giveaway_end: {
    label: "Terminer un giveaway maintenant",
    category: "server",
    permission: "server.giveaways.manage",
    fields: [],
    textFields: [{ key: "id", label: "ID du giveaway (optionnel, sinon le dernier)", max: 30, required: false }],
    ready: () => true,
    run: async (client, interaction, v) => {
      const msg = fakeMessage(interaction, {});
      await endGiveaway(client, msg, v.text?.id ? [v.text.id] : []);
    },
  },

  choose_random: {
    label: "Choisir au hasard",
    category: "server",
    permission: "server.tools.use",
    fields: [],
    textFields: [{ key: "options", label: "Options séparées par ,,", max: 200 }],
    ready: (v) => Boolean(v.text?.options),
    run: async (client, interaction, v) => {
      const msg = fakeMessage(interaction, {});
      await serverExtra.choose(client, msg, [v.text.options]);
    },
  },

  create_emoji: {
    label: "Créer un émoji",
    category: "server",
    permission: "server.channels.manage",
    fields: [],
    textFields: [
      { key: "url", label: "Lien de l'image", max: 300 },
      { key: "name", label: "Nom de l'émoji", max: 32 },
    ],
    ready: (v) => Boolean(v.text?.url && v.text?.name),
    run: async (client, interaction, v) => {
      const msg = fakeMessage(interaction, {});
      await serverExtra.createEmoji(client, msg, [v.text.url, v.text.name]);
    },
  },

  massiverole_action: {
    label: "Ajouter un rôle à tous les membres",
    category: "server",
    permission: "server.roles.manage",
    fields: ["roles"],
    ready: (v) => Boolean(v.roleIds?.length),
    run: async (client, interaction, v) => {
      const roles = v.roleIds.map((id) => interaction.guild.roles.cache.get(id)).filter(Boolean);
      if (!roles.length) return interaction.followUp({ content: "Rôle(s) introuvable(s).", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { roles });
      await serverExtra.massiverole(client, msg);
    },
  },

  unmassiverole_action: {
    label: "Retirer un rôle à tous les membres",
    category: "server",
    permission: "server.roles.manage",
    fields: ["roles"],
    ready: (v) => Boolean(v.roleIds?.length),
    run: async (client, interaction, v) => {
      const roles = v.roleIds.map((id) => interaction.guild.roles.cache.get(id)).filter(Boolean);
      if (!roles.length) return interaction.followUp({ content: "Rôle(s) introuvable(s).", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { roles });
      await serverExtra.unmassiverole(client, msg);
    },
  },

  voicemove_action: {
    label: "Déplacer tout un salon vocal",
    category: "voice",
    permission: "server.voice.moveall",
    fields: ["channel", "channel2"],
    ready: (v) => Boolean(v.channelId && v.channelId2),
    run: async (client, interaction, v) => {
      const from = interaction.guild.channels.cache.get(v.channelId);
      const to = interaction.guild.channels.cache.get(v.channelId2);
      if (!from || !to) return interaction.followUp({ content: "Salon introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { channels: [from, to] });
      await serverExtra.voicemove(client, msg);
    },
  },

  voicekick_action: {
    label: "Expulser un membre du vocal",
    category: "voice",
    permission: "server.voice.manage",
    fields: ["user"],
    ready: (v) => Boolean(v.userId),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      if (!member) return interaction.followUp({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member });
      await serverExtra.voicekick(client, msg, [member.id]);
    },
  },

  bringall_action: {
    label: "Rassembler tout le monde en vocal",
    category: "voice",
    permission: "server.voice.moveall",
    fields: ["channel"],
    ready: (v) => Boolean(v.channelId),
    run: async (client, interaction, v) => {
      const channel = interaction.guild.channels.cache.get(v.channelId);
      if (!channel) return interaction.followUp({ content: "Salon introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { channels: [channel] });
      await serverExtra.bringall(client, msg);
    },
  },

  temprole_action: {
    label: "Donner un rôle temporaire",
    category: "voice",
    permission: "members.role",
    fields: ["user", "role"],
    textFields: [{ key: "duration", label: "Durée (ex : 1d, 12h)", max: 20 }],
    ready: (v) => Boolean(v.userId && v.roleId && v.text?.duration),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      const role = interaction.guild.roles.cache.get(v.roleId);
      if (!member || !role) return interaction.followUp({ content: "Membre ou rôle introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member, role });
      await serverExtra.temprole(client, msg, [member.id, v.text.duration]);
    },
  },

  untemprole_action: {
    label: "Retirer un rôle temporaire",
    category: "voice",
    permission: "members.role",
    fields: ["user", "role"],
    ready: (v) => Boolean(v.userId && v.roleId),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      const role = interaction.guild.roles.cache.get(v.roleId);
      if (!member || !role) return interaction.followUp({ content: "Membre ou rôle introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member, role });
      await serverExtra.untemprole(client, msg, [member.id]);
    },
  },

  online_action: {
    label: "Statut du bot : En ligne",
    category: "botcontrol",
    permission: "sys",
    fields: [],
    ready: () => true,
    run: async (client, interaction) => {
      const msg = fakeMessage(interaction, {});
      await botProfileCommands.botProfileHandlers.online(client, msg);
    },
  },

  idle_action: {
    label: "Statut du bot : Inactif",
    category: "botcontrol",
    permission: "sys",
    fields: [],
    ready: () => true,
    run: async (client, interaction) => {
      const msg = fakeMessage(interaction, {});
      await botProfileCommands.botProfileHandlers.idle(client, msg);
    },
  },

  dnd_action: {
    label: "Statut du bot : Ne pas déranger",
    category: "botcontrol",
    permission: "sys",
    fields: [],
    ready: () => true,
    run: async (client, interaction) => {
      const msg = fakeMessage(interaction, {});
      await botProfileCommands.botProfileHandlers.dnd(client, msg);
    },
  },

  invisible_action: {
    label: "Statut du bot : Invisible",
    category: "botcontrol",
    permission: "sys",
    fields: [],
    ready: () => true,
    run: async (client, interaction) => {
      const msg = fakeMessage(interaction, {});
      await botProfileCommands.botProfileHandlers.invisible(client, msg);
    },
  },

  remove_activity_action: {
    label: "Supprimer l'activité du bot",
    category: "botcontrol",
    permission: "sys",
    fields: [],
    ready: () => true,
    run: async (client, interaction) => {
      const msg = fakeMessage(interaction, {});
      await botProfileCommands.botProfileHandlers.remove(client, msg, ["activity"]);
    },
  },

  // --- Généralisation des sélecteurs natifs à des commandes déjà existantes
  // qui manipulent un rôle/membre/salon mais n'avaient pas encore de carte.
  // Volontairement PAS toutes les commandes du catalogue : exclues celles
  // qui ont déjà un raccourci utile sans argument — &modlogs (derniers logs),
  // &sync (synchronise le salon courant), &wl/&unwl (affichent la whitelist),
  // les commandes &xlog (affichent l'état actuel ET retombent sur le salon
  // courant avec juste "on") — leur donner une carte remplacerait ce
  // raccourci par un clic en plus au lieu d'améliorer quoi que ce soit,
  // même logique que le tri déjà fait plus haut ("on a abusé"). &clear reste
  // muet sans cible pour laisser la main au CrowBot, jamais intercepté ici.
  // &cleanup/&openmodmail/&restrict/&nolog/&noderank/&piconly/&public
  // n'ont PAS de vrai handler câblé (catalogue documenté mais pas
  // implémenté, voir utils/implementedCommands.js) : aucune carte n'est
  // ajoutée pour des commandes qui ne répondraient de toute façon rien.

  del_sanction_member: {
    label: "Supprimer une sanction précise",
    category: "moderation",
    permission: "logs.manage",
    fields: ["user"],
    textFields: [{ key: "index", label: "Numéro de la sanction (voir &sanctions)", max: 5 }],
    ready: (v) => Boolean(v.userId && v.text?.index),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      if (!member) return interaction.followUp({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member });
      await moderationExtra.delSanction(client, msg, [member.id, v.text.index]);
    },
  },

  role_admin_grant: {
    label: "Donner/retirer Administrateur à un rôle",
    category: "server",
    permission: "server.roles.admin_grant",
    fields: ["role"],
    ready: (v) => Boolean(v.roleId),
    run: async (client, interaction, v) => {
      const role = interaction.guild.roles.cache.get(v.roleId);
      if (!role) return interaction.followUp({ content: "Rôle introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { role });
      await serverAdmin.roleAdmin(client, msg, ["admin"]);
    },
  },

  voicehub_set: {
    label: "Configurer le salon générateur de vocaux",
    category: "voice",
    permission: "server.voice.manage",
    fields: ["channel"],
    ready: (v) => Boolean(v.channelId),
    run: async (client, interaction, v) => {
      const channel = interaction.guild.channels.cache.get(v.channelId);
      if (!channel) return interaction.followUp({ content: "Salon introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { channels: [channel] });
      await serverAdmin.voicehub(client, msg, []);
    },
  },

  set_muterole_grant: {
    label: "Régler le rôle de mute",
    category: "protection",
    permission: "protection.automod",
    fields: ["role"],
    ready: (v) => Boolean(v.roleId),
    run: async (client, interaction, v) => {
      const role = interaction.guild.roles.cache.get(v.roleId);
      if (!role) return interaction.followUp({ content: "Rôle introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { role });
      await moderationExtra.setMuteRole(client, msg, []);
    },
  },

  autoreact_add: {
    label: "Ajouter une réaction automatique",
    category: "server",
    permission: "server.channels.manage",
    fields: ["channel"],
    textFields: [{ key: "emoji", label: "Émoji", max: 50 }],
    ready: (v) => Boolean(v.channelId && v.text?.emoji),
    run: async (client, interaction, v) => {
      const channel = interaction.guild.channels.cache.get(v.channelId);
      if (!channel) return interaction.followUp({ content: "Salon introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { channels: [channel] });
      await serverExtra.autoreact(client, msg, ["add", v.text.emoji]);
    },
  },

  autoreact_del: {
    label: "Retirer une réaction automatique",
    category: "server",
    permission: "server.channels.manage",
    fields: ["channel"],
    textFields: [{ key: "emoji", label: "Émoji", max: 50 }],
    ready: (v) => Boolean(v.channelId && v.text?.emoji),
    run: async (client, interaction, v) => {
      const channel = interaction.guild.channels.cache.get(v.channelId);
      if (!channel) return interaction.followUp({ content: "Salon introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { channels: [channel] });
      await serverExtra.autoreact(client, msg, ["del", v.text.emoji]);
    },
  },

  link_channel_exempt: {
    label: "Exempter un salon de l'anti-lien",
    category: "protection",
    permission: "protection.automod",
    fields: ["channel"],
    optionalFields: ["channel"],
    fieldLabels: { channel: "Salon (optionnel, sinon le salon courant)" },
    choiceFields: [
      {
        key: "action",
        label: "Action",
        placeholder: "Choisir allow / deny / reset",
        noCustom: true,
        options: [
          { label: "Exempter (allow)", value: "allow" },
          { label: "Surveiller à nouveau (deny)", value: "deny" },
          { label: "Réinitialiser (reset)", value: "reset" },
        ],
      },
    ],
    ready: (v) => Boolean(v.text?.action),
    run: async (client, interaction, v) => {
      const channel = v.channelId ? interaction.guild.channels.cache.get(v.channelId) : null;
      const msg = fakeMessage(interaction, { channels: channel ? [channel] : [] });
      await automodHandlers.link(client, msg, [v.text.action]);
    },
  },

  spam_channel_exempt: {
    label: "Exempter un salon de l'anti-spam",
    category: "protection",
    permission: "protection.automod",
    fields: ["channel"],
    optionalFields: ["channel"],
    fieldLabels: { channel: "Salon (optionnel, sinon le salon courant)" },
    choiceFields: [
      {
        key: "action",
        label: "Action",
        placeholder: "Choisir allow / deny / reset",
        noCustom: true,
        options: [
          { label: "Exempter (allow)", value: "allow" },
          { label: "Surveiller à nouveau (deny)", value: "deny" },
          { label: "Réinitialiser (reset)", value: "reset" },
        ],
      },
    ],
    ready: (v) => Boolean(v.text?.action),
    run: async (client, interaction, v) => {
      const channel = v.channelId ? interaction.guild.channels.cache.get(v.channelId) : null;
      const msg = fakeMessage(interaction, { channels: channel ? [channel] : [] });
      await automodHandlers.spam(client, msg, [v.text.action]);
    },
  },

  antinuke_wluser: {
    label: "Whitelist anti-nuke : (dé)exempter un membre",
    category: "protection",
    permission: "protection.guard.manage",
    fields: ["user"],
    ready: (v) => Boolean(v.userId),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      if (!member) return interaction.followUp({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member });
      await serverAdmin.antinuke(client, msg, ["wluser", member.id]);
    },
  },

  antinuke_wlrole: {
    label: "Whitelist anti-nuke : (dé)exempter un rôle",
    category: "protection",
    permission: "protection.guard.manage",
    fields: ["role"],
    ready: (v) => Boolean(v.roleId),
    run: async (client, interaction, v) => {
      const role = interaction.guild.roles.cache.get(v.roleId);
      if (!role) return interaction.followUp({ content: "Rôle introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { role });
      await serverAdmin.antinuke(client, msg, ["wlrole"]);
    },
  },

  antinuke_ping: {
    label: "Régler le rôle pingé par l'anti-nuke",
    category: "protection",
    permission: "protection.guard.manage",
    fields: ["role"],
    optionalFields: ["role"],
    fieldLabels: { role: "Rôle à pinguer (aucun = désactivé)" },
    ready: () => true,
    run: async (client, interaction, v) => {
      const role = v.roleId ? interaction.guild.roles.cache.get(v.roleId) : null;
      const msg = fakeMessage(interaction, { role });
      await serverAdmin.antinuke(client, msg, role ? ["ping"] : ["ping", "off"]);
    },
  },

  set_perm_grant: {
    label: "Accorder une permission à un rôle ou un membre",
    category: "server",
    permission: "panel.permissions.manage",
    fields: ["mentionable"],
    choiceFields: [
      {
        key: "category",
        label: "Catégorie",
        placeholder: "Choisir une catégorie de permissions",
        noCustom: true,
        resets: ["key"],
        options: permCatalog.byCategory().map((c) => ({ label: c.label, value: c.category })),
      },
      {
        key: "key",
        label: "Permission",
        placeholder: "Choisir une clé de permission",
        noCustom: true,
        showIf: (active) => Boolean(active.text?.category),
        options: (active) => {
          const cat = permCatalog.byCategory().find((c) => c.category === active.text?.category);
          return (cat?.permissions || []).map((p) => ({ label: p.label.slice(0, 100), value: p.key }));
        },
      },
    ],
    ready: (v) => Boolean(v.mentionableId && v.text?.key),
    run: async (client, interaction, v) => {
      const msg = await resolveMentionableMessage(interaction, v);
      if (!msg) return;
      await configHandlers.setPerm(client, msg, [v.text.key]);
    },
  },

  warn_member: {
    label: "Avertir un membre",
    category: "moderation",
    permission: "moderation.warn",
    emoji: EMOJI.INFO,
    fields: ["user"],
    textFields: [{ key: "reason", label: "Raison (optionnel)", max: 200, required: false }],
    ready: (v) => Boolean(v.userId),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      if (!member) return interaction.followUp({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member });
      await moderationExtra.warn(client, msg, [member.id, ...(v.text?.reason ? [v.text.reason] : [])]);
    },
  },

  warnings_view: {
    label: "Voir les avertissements d'un membre",
    category: "moderation",
    permission: "logs.view",
    fields: ["user"],
    ready: (v) => Boolean(v.userId),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      if (!member) return interaction.followUp({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member });
      await moderationExtra.warnings(client, msg, [member.id]);
    },
  },

  unwarn_member: {
    label: "Retirer un avertissement",
    category: "moderation",
    permission: "logs.manage",
    emoji: EMOJI.CROSS,
    fields: ["user"],
    textFields: [{ key: "caseNumber", label: "Numéro de case (voir &warnings)", max: 10 }],
    ready: (v) => Boolean(v.userId && v.text?.caseNumber),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      if (!member) return interaction.followUp({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member });
      await moderationExtra.unwarn(client, msg, [member.id, v.text.caseNumber]);
    },
  },

  case_view: {
    label: "Voir le détail d'une case",
    category: "moderation",
    permission: "logs.view",
    fields: [],
    textFields: [{ key: "number", label: "Numéro de case", max: 10 }],
    ready: (v) => Boolean(v.text?.number),
    run: async (client, interaction, v) => {
      const msg = fakeMessage(interaction, {});
      await moderationExtra.caseView(client, msg, [v.text.number]);
    },
  },

  autorole_add: {
    label: "Ajouter un rôle automatique",
    category: "server",
    permission: "members.autorole.manage",
    fields: ["role"],
    ready: (v) => Boolean(v.roleId),
    run: async (client, interaction, v) => {
      const role = interaction.guild.roles.cache.get(v.roleId);
      if (!role) return interaction.followUp({ content: "Rôle introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { role });
      await autoroleHandlers.add(client, msg, []);
    },
  },

  autorole_del: {
    label: "Retirer un rôle automatique",
    category: "server",
    permission: "members.autorole.manage",
    fields: ["role"],
    ready: (v) => Boolean(v.roleId),
    run: async (client, interaction, v) => {
      const role = interaction.guild.roles.cache.get(v.roleId);
      if (!role) return interaction.followUp({ content: "Rôle introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { role });
      await autoroleHandlers.del(client, msg, []);
    },
  },

  del_perm_grant: {
    label: "Retirer une permission d'un rôle ou d'un membre",
    category: "server",
    permission: "panel.permissions.manage",
    fields: ["mentionable"],
    choiceFields: [
      {
        key: "category",
        label: "Catégorie",
        placeholder: "Choisir une catégorie de permissions",
        noCustom: true,
        resets: ["key"],
        options: permCatalog.byCategory().map((c) => ({ label: c.label, value: c.category })),
      },
      {
        key: "key",
        label: "Permission",
        placeholder: "Choisir une clé de permission",
        noCustom: true,
        showIf: (active) => Boolean(active.text?.category),
        options: (active) => {
          const cat = permCatalog.byCategory().find((c) => c.category === active.text?.category);
          return (cat?.permissions || []).map((p) => ({ label: p.label.slice(0, 100), value: p.key }));
        },
      },
    ],
    ready: (v) => Boolean(v.mentionableId && v.text?.key),
    run: async (client, interaction, v) => {
      const msg = await resolveMentionableMessage(interaction, v);
      if (!msg) return;
      await configHandlers.delPerm(client, msg, [v.text.key]);
    },
  },
};

/**
 * Extrait ce qui est déjà déterminable (membre/rôle/salon, mention OU ID)
 * depuis une commande tapée avec des arguments INSUFFISANTS — sert à
 * pré-remplir la carte plutôt que de la montrer vide (voir
 * structuralFieldsSatisfied + utils/musicCommands.js). Les champs texte ne
 * sont jamais devinés ici, seulement remplis via la modale de la carte.
 */
function extractFormValues(form, message, args) {
  const values = {};
  const used = new Set();

  if (form.fields.includes("user")) {
    const mentioned = message.mentions.members?.first() || message.mentions.users?.first();
    if (mentioned) {
      values.userId = mentioned.id;
      used.add(mentioned.id);
    } else {
      const idArg = args.find((a) => /^\d{15,25}$/.test(a) && !used.has(a));
      if (idArg) {
        values.userId = idArg;
        used.add(idArg);
      }
    }
  }
  if (form.fields.includes("role")) {
    const mentioned = message.mentions.roles?.first();
    if (mentioned) {
      values.roleId = mentioned.id;
      used.add(mentioned.id);
    } else {
      const idArg = args.find((a) => /^\d{15,25}$/.test(a) && !used.has(a));
      if (idArg) {
        values.roleId = idArg;
        used.add(idArg);
      }
    }
  }
  if (form.fields.includes("channel")) {
    const mentioned = message.mentions.channels?.first();
    if (mentioned) values.channelId = mentioned.id;
  }
  if (form.fields.includes("mentionable")) {
    const mentionedRole = message.mentions.roles?.first();
    const mentionedUser = message.mentions.members?.first() || message.mentions.users?.first();
    if (mentionedRole) {
      values.mentionableId = mentionedRole.id;
      values.mentionableType = "role";
    } else if (mentionedUser) {
      values.mentionableId = mentionedUser.id;
      values.mentionableType = "user";
    } else {
      // Un ID brut seul est ambigu (rôle ou membre) : on tranche en
      // vérifiant s'il correspond à un rôle du serveur, sinon on suppose un
      // membre — même logique que &wl/&unwl (utils/guardCommands.js).
      const idArg = args.find((a) => /^\d{15,25}$/.test(a) && !used.has(a));
      if (idArg) {
        values.mentionableId = idArg;
        values.mentionableType = message.guild.roles.cache.has(idArg) ? "role" : "user";
      }
    }
  }
  return values;
}

/**
 * Vrai si tous les champs MEMBRE/RÔLE requis du formulaire sont déjà
 * déterminés — sert de garde-fou avant d'intercepter une commande tapée
 * avec ses arguments pour ouvrir la carte à sa place (voir
 * utils/musicCommands.js, "directFormKey").
 *
 * "channel"/"channel2" sont volontairement EXCLUS de ce garde-fou : dans la
 * syntaxe texte réelle, un salon n'est presque jamais donné en mention à un
 * emplacement fixe (giveaway/poll/ticket/dero postent dans le salon COURANT,
 * implicitement) — l'exiger bloquait purement et simplement l'exécution
 * directe de commandes tapées avec tous leurs arguments : "&giveaway start
 * 1h Nitro" ouvrait une carte vide au lieu de lancer le giveaway, faute
 * d'une mention de salon que la syntaxe ne prévoit même pas. Les commandes
 * qui prennent vraiment un salon en argument (bringall, voicemove...) sont
 * déjà correctement gérées par leur VRAI handler texte, qui parse ses
 * propres arguments sans dépendre de ce garde-fou.
 *
 * Un champ listé dans `form.optionalFields` n'est jamais requis non plus.
 */
function structuralFieldsSatisfied(form, values) {
  const optional = new Set(form.optionalFields || []);
  return form.fields
    .filter((f) => ["user", "role", "roles", "mentionable"].includes(f) && !optional.has(f))
    .every((f) => {
      if (f === "user") return Boolean(values.userId);
      if (f === "role") return Boolean(values.roleId);
      if (f === "roles") return Boolean(values.roleIds?.length);
      if (f === "mentionable") return Boolean(values.mentionableId);
      return true;
    });
}

// État en mémoire du formulaire EN COURS, par (personne, commande) — une
// personne peut avoir plusieurs cartes différentes ouvertes en même temps
// (une par commande tapée), donc la clé doit inclure la commande, pas
// seulement qui interagit.
const formState = new Map();
const stateKey = (userId, formKey) => `${userId}:${formKey}`;

// Saisie des champs texte EN COURS (voir collectTextFields) — empêche de
// démarrer une deuxième collecte en double si on reclique pendant qu'une
// réponse est attendue.
const pendingTextCapture = new Set();

function getFormState(userId, formKey) {
  return formState.get(stateKey(userId, formKey)) || null;
}
function setFormState(userId, formKey, patch) {
  const key = stateKey(userId, formKey);
  const current = formState.get(key) || { text: {} };
  const next = { ...current, ...patch, text: { ...current.text, ...(patch.text || {}) } };
  formState.set(key, next);
  return next;
}
function clearFormState(userId, formKey) {
  formState.delete(stateKey(userId, formKey));
}

// --- Carte autonome, postée directement dans le salon quand une commande
// avec formulaire est tapée sans ses arguments (voir BARE_COMMAND_FORMS et
// utils/musicCommands.js) — même mécanisme que &panel > Exécuter avait,
// mais en carte indépendante plutôt que nichée dans la navigation du panel
// (ce dernier ne garde plus que les vraies rubriques de configuration).
const CARD_ID = "cmdrun";

// Valeur réservée de l'option "Autre" d'un menu déroulant : elle rebascule ce
// SEUL champ sur la saisie écrite dans le salon. Les listes proposées couvrent
// les cas courants sans jamais les imposer — demande explicite : "au choix ou
// à l'écrit".
const CUSTOM_CHOICE = "__autre__";

// Limite dure de Discord pour les composants d'un Container : 10. On travaille
// à 9 pour ne jamais s'y coller.
const CONTAINER_BUDGET = 9;

function buildFormCard(formKey, member) {
  const form = FORMS[formKey];
  if (!form) return null;
  const active = getFormState(member.id, formKey) || {};

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${form.label}`));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  // Un formulaire peut renommer un champ générique quand "Rôle" ou "Salon"
  // tout court ne dit pas ce qu'il fait là (ex : le rôle d'un giveaway filtre
  // qui a le droit de participer).
  const labelFor = (key, fallback) => form.fieldLabels?.[key] || fallback;
  const isOptional = (key) => form.optionalFields?.includes(key);

  const lines = [];
  if (form.fields.includes("channel")) lines.push(`> **${labelFor("channel", "Salon")}** : ${active.channelId ? `<#${active.channelId}>` : "*non choisi*"}`);
  if (form.fields.includes("channel2")) lines.push(`> **Salon (destination)** : ${active.channelId2 ? `<#${active.channelId2}>` : "*non choisi*"}`);
  if (form.fields.includes("role")) {
    lines.push(`> **${labelFor("role", "Rôle")}** : ${active.roleId ? `<@&${active.roleId}>` : isOptional("role") ? "*aucun (ouvert à tous)*" : "*non choisi*"}`);
  }
  if (form.fields.includes("roles")) {
    lines.push(`> **Rôle(s)** : ${active.roleIds?.length ? active.roleIds.map((id) => `<@&${id}>`).join(", ") : "*non choisis*"}`);
  }
  if (form.fields.includes("user")) lines.push(`> **Membre** : ${active.userId ? `<@${active.userId}>` : "*non choisi*"}`);
  if (form.fields.includes("mentionable")) {
    const mention = active.mentionableId ? (active.mentionableType === "role" ? `<@&${active.mentionableId}>` : `<@${active.mentionableId}>`) : null;
    lines.push(`> **${labelFor("mentionable", "Membre ou rôle")}** : ${mention || "*non choisi*"}`);
  }
  for (const cf of form.choiceFields || []) {
    if (cf.showIf && !cf.showIf(active)) continue;
    const value = active.text?.[cf.key];
    lines.push(`> **${cf.label}** : ${value ? `\`${value}\`` : cf.required === false ? "*non choisi (optionnel)*" : "*non choisi*"}`);
  }
  for (const tf of form.textFields || []) {
    const value = active.text?.[tf.key];
    lines.push(`> **${tf.label}** : ${value ? `\`${value}\`` : tf.required === false ? "*non rempli (optionnel)*" : "*non rempli*"}`);
  }
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.length ? lines.join("\n") : "Aucun paramètre nécessaire."));

  // Les contrôles sont assemblés à part : c'est leur nombre qui décide, plus
  // bas, si le séparateur décoratif tient encore dans le budget du container.
  const rows = [];

  if (form.fields.includes("channel")) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${CARD_ID}:channel:${formKey}`)
          .setPlaceholder("Choisir un salon")
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice)
          .setMinValues(0)
          .setMaxValues(1)
      )
    );
  }
  if (form.fields.includes("channel2")) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${CARD_ID}:channel2:${formKey}`)
          .setPlaceholder("Choisir le salon de destination")
          .addChannelTypes(ChannelType.GuildVoice)
          .setMinValues(0)
          .setMaxValues(1)
      )
    );
  }
  if (form.fields.includes("role")) {
    const roleSelect = new RoleSelectMenuBuilder().setCustomId(`${CARD_ID}:role:${formKey}`).setPlaceholder(labelFor("role", "Choisir un rôle"));
    // Optionnel = on doit aussi pouvoir revenir en arrière et n'en choisir aucun.
    if (isOptional("role")) roleSelect.setMinValues(0).setMaxValues(1);
    rows.push(new ActionRowBuilder().addComponents(roleSelect));
  }
  if (form.fields.includes("roles")) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(`${CARD_ID}:roles:${formKey}`).setPlaceholder("Choisir un ou plusieurs rôles").setMinValues(1).setMaxValues(10)
      )
    );
  }
  if (form.fields.includes("user")) {
    rows.push(
      new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${CARD_ID}:user:${formKey}`).setPlaceholder("Choisir un membre"))
    );
  }
  if (form.fields.includes("mentionable")) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new MentionableSelectMenuBuilder()
          .setCustomId(`${CARD_ID}:mentionable:${formKey}`)
          .setPlaceholder(labelFor("mentionable", "Choisir un membre ou un rôle"))
      )
    );
  }

  for (const cf of form.choiceFields || []) {
    // showIf : n'affiche ce menu qu'une fois un choix précédent fait (ex : la
    // clé de permission dépend de la catégorie choisie juste avant, voir
    // set_perm_grant/del_perm_grant). Sans condition, toujours affiché.
    if (cf.showIf && !cf.showIf(active)) continue;
    const current = active.text?.[cf.key];
    // Les options peuvent dépendre de l'état courant (ex : la liste des clés
    // change selon la catégorie déjà choisie) — tableau statique sinon.
    const rawOptions = typeof cf.options === "function" ? cf.options(active) : cf.options;
    const options = rawOptions.map((o) =>
      new StringSelectMenuOptionBuilder().setLabel(o.label).setValue(o.value).setDefault(current === o.value)
    );
    // "Autre…" (saisie libre) n'a pas de sens pour un choix fermé comme une
    // clé de permission — cf.noCustom le supprime.
    if (!cf.noCustom) {
      options.push(
        new StringSelectMenuOptionBuilder()
          .setLabel(cf.customLabel || "Autre…")
          .setValue(CUSTOM_CHOICE)
          .setDescription("Répondre à l'écrit dans le salon")
      );
    }
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${CARD_ID}:choice:${formKey}:${cf.key}`)
          .setPlaceholder(cf.placeholder || cf.label)
          .addOptions(options)
      )
    );
  }

  const buttons = [];
  if (form.textFields?.length) {
    const capturing = pendingTextCapture.has(stateKey(member.id, formKey));
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`${CARD_ID}:textopen:${formKey}`)
        .setLabel(capturing ? "Réponse en attente dans le salon..." : "Remplir dans le salon")
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(capturing)
    );
  }
  const launchButton = new ButtonBuilder()
    .setCustomId(`${CARD_ID}:launch:${formKey}`)
    .setLabel("Lancer")
    .setStyle(ButtonStyle.Success)
    .setDisabled(!form.ready(active));
  if (form.emoji) launchButton.setEmoji(form.emoji);
  buttons.push(launchButton);
  rows.push(new ActionRowBuilder().addComponents(...buttons));

  // Un Container Components V2 accepte 10 composants au maximum, et on en garde
  // volontairement un de libre. Quand un formulaire a beaucoup de menus (le
  // giveaway et ses trois listes déroulantes), c'est le séparateur décoratif
  // avant les contrôles qui saute — jamais un champ, et jamais un message
  // refusé par Discord le jour où un champ de plus est ajouté.
  const used = 3 + rows.length; // titre + séparateur + résumé
  if (used + 1 <= CONTAINER_BUDGET) container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  for (const row of rows) container.addActionRowComponents(row);

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

const TEXT_CAPTURE_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Remplace la modale native (popup gris, hors du style Components V2 utilisé
 * partout ailleurs — demande explicite de ne plus l'utiliser) : demande
 * chaque champ texte un par un directement dans le salon et attend la
 * prochaine réponse de la personne. Champs optionnels : `-` pour passer.
 */
async function collectTextFields(interaction, form, formKey, fields = form.textFields) {
  // Une carte affichée AVANT que le formulaire ne change (ses champs texte
  // devenus des menus déroulants, par exemple) peut encore envoyer un
  // "textopen" : on le dit au lieu de planter sur une liste inexistante.
  const toCollect = fields || [];
  if (!toCollect.length) {
    return interaction.reply({
      content: "Cette carte n'a plus de champ à remplir à l'écrit — relance la commande pour ouvrir la version à jour.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const key = stateKey(interaction.user.id, formKey);
  if (pendingTextCapture.has(key)) {
    return interaction.reply({ content: "Une saisie est déjà en cours pour cette carte — réponds dans le salon.", flags: MessageFlags.Ephemeral });
  }
  pendingTextCapture.add(key);

  const channel = interaction.channel;
  await interaction.reply({
    content: `Réponds dans ce salon, un message par champ (${TEXT_CAPTURE_TIMEOUT_MS / 1000}s par réponse).`,
    flags: MessageFlags.Ephemeral,
  });
  await interaction.message?.edit(buildFormCard(formKey, interaction.member)).catch(() => {});

  const text = { ...(getFormState(interaction.user.id, formKey)?.text || {}) };
  for (const tf of toCollect) {
    // Un essai précédent a déjà rempli ce champ (reprise après un timeout,
    // par exemple) — pas la peine de le redemander.
    if (text[tf.key] !== undefined) continue;
    const optionalHint = tf.required === false ? " *(optionnel — tape `-` pour passer)*" : "";
    await channel.send(`<@${interaction.user.id}> **${tf.label}**${optionalHint} :`).catch(() => {});

    let collected;
    try {
      collected = await channel.awaitMessages({
        filter: (m) => m.author.id === interaction.user.id,
        max: 1,
        time: TEXT_CAPTURE_TIMEOUT_MS,
        errors: ["time"],
      });
    } catch {
      await channel.send(`<@${interaction.user.id}> Temps écoulé — ce qui a déjà été rempli est conservé, reclique sur "Remplir dans le salon" pour continuer.`).catch(() => {});
      pendingTextCapture.delete(key);
      setFormState(interaction.user.id, formKey, { text });
      return interaction.message?.edit(buildFormCard(formKey, interaction.member)).catch(() => {});
    }

    const raw = collected.first().content.trim();
    if (tf.required === false && (raw === "-" || raw === "")) {
      // champ optionnel passé
    } else {
      text[tf.key] = raw.slice(0, tf.max || 200);
    }
  }

  pendingTextCapture.delete(key);
  setFormState(interaction.user.id, formKey, { text });
  await channel.send(`<@${interaction.user.id}> Champs enregistrés.`).catch(() => {});
  return interaction.message?.edit(buildFormCard(formKey, interaction.member)).catch(() => {});
}

/** Toutes les interactions "cmdrun:" (voir index.js). */
async function handleFormCardInteraction(interaction) {
  const [, action, formKey] = interaction.customId.split(":");
  const form = FORMS[formKey];
  if (!form) return;
  if (form.permission !== undefined && !can(interaction.member, form.permission)) {
    return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
  }

  if (["channel", "channel2", "role", "roles", "user", "mentionable"].includes(action)) {
    let patch;
    if (action === "channel") patch = { channelId: interaction.values[0] || null };
    else if (action === "channel2") patch = { channelId2: interaction.values[0] || null };
    else if (action === "role") patch = { roleId: interaction.values[0] || null };
    else if (action === "roles") patch = { roleIds: interaction.values };
    else if (action === "mentionable") {
      const roleHit = interaction.roles?.first();
      const userHit = interaction.members?.first() || interaction.users?.first();
      patch = roleHit
        ? { mentionableId: roleHit.id, mentionableType: "role" }
        : userHit
        ? { mentionableId: userHit.id, mentionableType: "user" }
        : { mentionableId: null, mentionableType: null };
    } else patch = { userId: interaction.values[0] || null };
    setFormState(interaction.user.id, formKey, patch);
    return interaction.update(buildFormCard(formKey, interaction.member));
  }

  if (action === "choice") {
    const fieldKey = interaction.customId.split(":")[3];
    const field = (form.choiceFields || []).find((f) => f.key === fieldKey);
    if (!field) return;

    if (interaction.values[0] === CUSTOM_CHOICE) {
      // On remet la valeur à `undefined` (et non "on la laisse") pour que la
      // collecte la redemande vraiment : sans ça, choisir "Autre" après avoir
      // déjà choisi une option de la liste ne rouvrirait aucune question.
      setFormState(interaction.user.id, formKey, { text: { [fieldKey]: undefined } });
      return collectTextFields(interaction, form, formKey, [
        { key: field.key, label: field.customPrompt || field.label, max: field.max || 200, required: field.required },
      ]);
    }

    // Un champ peut invalider un choix suivant (ex : changer de catégorie de
    // permission doit oublier la clé déjà choisie dans l'ancienne).
    const resetPatch = {};
    for (const key of field.resets || []) resetPatch[key] = undefined;
    setFormState(interaction.user.id, formKey, { text: { [fieldKey]: interaction.values[0], ...resetPatch } });
    return interaction.update(buildFormCard(formKey, interaction.member));
  }

  if (action === "textopen") {
    return collectTextFields(interaction, form, formKey);
  }

  if (action === "launch") {
    const active = getFormState(interaction.user.id, formKey) || {};
    if (!form.ready(active)) return interaction.reply({ content: "Des champs obligatoires manquent encore.", flags: MessageFlags.Ephemeral });
    await interaction.deferUpdate();
    // Le résultat doit REMPLACER la carte de formulaire, pas arriver dans un
    // second message éphémère à côté d'elle : c'est le même geste, il mérite
    // un seul message. `fakeMessage` lit ce marqueur pour éditer le message
    // d'origine à la première réponse de la commande.
    remplacerParLaReponse(interaction);
    try {
      await form.run(interaction.client, interaction, active);
    } catch (err) {
      console.error("[commandForms]", err);
      await interaction.followUp({ content: `Erreur pendant l'exécution : ${err.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    clearFormState(interaction.user.id, formKey);
    // Le formulaire n'est remis à blanc que s'il est encore là : quand la
    // commande a répondu, sa réponse occupe déjà la place du message.
    if (aEteRemplace(interaction)) return undefined;
    return interaction.message?.edit(buildFormCard(formKey, interaction.member)).catch(() => {});
  }
}

// Commande tapée (sans ses arguments, ou juste avec le mot de sous-commande
// pour un dispatcher partagé comme "role create") -> formulaire ouvert
// directement dans le salon au lieu de l'exécution texte classique — voir
// utils/musicCommands.js pour le branchement.
//
// Volontairement PAS toutes les FORMS : demande explicite ("on a abusé") de
// ne garder la carte que pour les commandes qui ont VRAIMENT plusieurs
// paramètres à choisir. Exclus :
//  - les commandes sans aucun paramètre (mutelist/unmuteall/banlist/
//    hideall/unhideall/online/idle/dnd/invisible/remove activity) — une
//    carte avec juste un bouton "Lancer" est plus lente qu'exécuter direct ;
//  - lock/unlock — un seul salon possible dans l'immense majorité des cas
//    (celui où on tape la commande), le sélecteur de salon n'apporte rien.
// Ces commandes s'exécutent donc directement, comme avant.
const BARE_COMMAND_FORMS = {
  giveaway: "giveaway_start",
  addrole: "addrole_member",
  delrole: "delrole_member",
  kick: "kick_member",
  ban: "ban_member",
  softban: "softban_member",
  unban: "unban_id",
  timeout: "timeout_member",
  untimeout: "untimeout_member",
  mute: "mute_member",
  unmute: "unmute_member",
  tempmute: "tempmute_member",
  tempban: "tempban_member",
  derank: "derank_member",
  poll: "poll_create",
  slowmode: "slowmode_channel",
  ticket: "ticket_setup",
  sanctions: "sanctions_view",
  dero: "dero_role",
  choose: "choose_random",
  create: "create_emoji",
  massiverole: "massiverole_action",
  unmassiverole: "unmassiverole_action",
  voicemove: "voicemove_action",
  voicekick: "voicekick_action",
  bringall: "bringall_action",
  temprole: "temprole_action",
  untemprole: "untemprole_action",
  end: "giveaway_end",
  // &cmute/&uncmute/&tempcmute sont des ALIAS texte de &mute/&unmute/&tempmute
  // (dispatchés séparément dans utils/musicCommands.js) — la table ci-dessus
  // est indexée sur le mot RÉELLEMENT tapé, donc chaque alias a besoin de sa
  // propre entrée vers la même carte que son équivalent non-"c".
  cmute: "mute_member",
  uncmute: "unmute_member",
  tempcmute: "tempmute_member",
  warn: "warn_member",
  warnings: "warnings_view",
  unwarn: "unwarn_member",
  case: "case_view",
  "autorole add": "autorole_add",
  "autorole del": "autorole_del",
  voicehub: "voicehub_set",
  link: "link_channel_exempt",
  spam: "spam_channel_exempt",
  // Clés à deux mots : commandes dont le premier mot est un dispatcher
  // partagé (&role/&channel/&clear gèrent plusieurs sous-commandes) —
  // voir utils/musicCommands.js pour la logique de correspondance.
  "role create": "role_create",
  "role delete": "role_delete",
  "role rename": "role_rename",
  "role color": "role_color",
  "role admin": "role_admin_grant",
  "channel delete": "channel_delete",
  "channel rename": "channel_rename",
  "channel topic": "channel_topic",
  "clear sanctions": "clear_sanctions_member",
  "giveaway reroll": "giveaway_reroll",
  "del sanction": "del_sanction_member",
  "del perm": "del_perm_grant",
  "set perm": "set_perm_grant",
  "set muterole": "set_muterole_grant",
  "autoreact add": "autoreact_add",
  "autoreact del": "autoreact_del",
  "antinuke wluser": "antinuke_wluser",
  "antinuke wlrole": "antinuke_wlrole",
  "antinuke ping": "antinuke_ping",
};

module.exports = {
  FORMS,
  CATEGORIES,
  BARE_COMMAND_FORMS,
  getFormState,
  setFormState,
  clearFormState,
  buildFormCard,
  handleFormCardInteraction,
  extractFormValues,
  structuralFieldsSatisfied,
  CARD_ID,
};
