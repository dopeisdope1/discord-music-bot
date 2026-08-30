const { Collection, MessageFlags } = require("discord.js");
const { startGiveaway } = require("./giveaways");
const { createPoll } = require("./polls");
const { setupTickets } = require("./tickets");
const { moderationHandlers } = require("./moderationCommands");
const moderationExtra = require("./moderationExtra");
const { channelHandlers } = require("./channelCommands");
const { handleBan, handleUnban } = require("./banPanel");
const serverAdmin = require("./serverAdminCommands");

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
 * @param {import('discord.js').Interaction} interaction
 * @param {{ channel?, user?, role?, text?: string }} [opts]
 */
function fakeMessage(interaction, { channel, user, role, text = "" } = {}) {
  const users = new Collection();
  const members = new Collection();
  const roles = new Collection();
  if (user) {
    users.set(user.id, user.user || user);
    if (user.roles) members.set(user.id, user); // un GuildMember complet (a .roles.cache) alimente aussi mentions.members
  }
  if (role) roles.set(role.id, role);

  return {
    author: interaction.user,
    member: interaction.member,
    guild: interaction.guild,
    channel: channel || interaction.channel,
    content: text,
    attachments: { first: () => null },
    mentions: { users, members, roles, everyone: false },
    reply: (payload) => interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {}),
  };
}

const FORMS = {
  giveaway_start: {
    label: "Lancer un giveaway",
    fields: ["channel"],
    textFields: [
      { key: "duration", label: "Durée (ex : 1h, 30m, 1d)", max: 20 },
      { key: "prize", label: "Lot", max: 200 },
    ],
    ready: (v) => Boolean(v.channelId && v.text?.duration && v.text?.prize),
    run: async (client, interaction, v) => {
      const channel = interaction.guild.channels.cache.get(v.channelId);
      const msg = fakeMessage(interaction, { channel });
      await startGiveaway(client, msg, [v.text.duration, v.text.prize]);
    },
  },

  poll_create: {
    label: "Créer un sondage",
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
    fields: ["user"],
    ready: (v) => Boolean(v.userId),
    run: async (client, interaction, v) => {
      const member = await interaction.guild.members.fetch(v.userId).catch(() => null);
      if (!member) return interaction.followUp({ content: "Membre introuvable.", flags: MessageFlags.Ephemeral });
      const msg = fakeMessage(interaction, { user: member });
      await moderationExtra.derank(client, msg, [member.id]);
    },
  },
};

// État en mémoire du formulaire EN COURS par personne (une seule commande à
// la fois par utilisateur, largement suffisant pour cet usage) — permet de
// faire survivre les choix (salon/rôle/membre/texte) d'une interaction à
// l'autre sans les faire voyager dans chaque customId.
const formState = new Map();

function getFormState(userId) {
  return formState.get(userId) || null;
}
function setFormState(userId, patch) {
  const current = formState.get(userId) || { text: {} };
  const next = { ...current, ...patch, text: { ...current.text, ...(patch.text || {}) } };
  formState.set(userId, next);
  return next;
}
function clearFormState(userId) {
  formState.delete(userId);
}

module.exports = { FORMS, getFormState, setFormState, clearFormState };
