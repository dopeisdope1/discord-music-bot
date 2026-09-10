const {
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { EMOJI } = require("./emojis");
const { can } = require("./permissions/engine");
const { checkBotPermission, report } = require("./moderation/actions");
const ticketStore = require("./ticketStore");

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });

const ID = "ticket";

function card(title, body, rows = []) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`));
  if (body) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  }
  for (const row of rows) container.addActionRowComponents(row);
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** &ticket setup [@role-staff] — poste le message "Ouvrir un ticket" dans le salon courant. */
async function setupTickets(client, message, args) {
  if (!can(message.member, "server.tickets.manage")) return;
  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.ManageChannels, "ManageChannels");
  if (botPerm) return reply(message, "error", botPerm);

  const staffRole = message.mentions.roles?.first();
  ticketStore.setStaffRole(message.guild.id, staffRole?.id || null);

  await message.channel.send(
    card(
      "Support",
      staffRole
        ? `Besoin d'aide ? Ouvre un ticket ci-dessous — visible seulement de toi et de <@&${staffRole.id}>.`
        : "Besoin d'aide ? Ouvre un ticket ci-dessous.",
      [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${ID}:open`).setLabel("Ouvrir un ticket").setStyle(ButtonStyle.Primary).setEmoji(EMOJI.TICKET)
        ),
      ]
    )
  );
  await reply(message, "success", "Message de tickets envoyé dans ce salon.");
}

/** Le salon courant est-il un ticket suivi par le bot ? Sinon, les commandes de gestion n'ont pas de sens ici. */
function requireTicket(message) {
  const info = ticketStore.getTicketInfo(message.channel.id);
  if (!info) {
    reply(message, "error", "Cette commande s'utilise dans un ticket ouvert.");
    return null;
  }
  return info;
}

/** Même droit de fermeture que le bouton : rôle dédié, rôle staff, permission, ou le demandeur si autorisé. */
function peutFermer(member, info, config) {
  const roleFermeture = config.closeRoleId || config.staffRoleId;
  return (
    (roleFermeture && member.roles.cache.has(roleFermeture)) ||
    can(member, "server.tickets.manage") ||
    (config.ownerCanClose && member.id === info.ownerId)
  );
}

/** &ticket claim — prend le ticket courant en charge. */
async function claimTicket(client, message) {
  if (!can(message.member, "server.tickets.manage")) return;
  const info = requireTicket(message);
  if (!info) return;

  ticketStore.claimTicket(message.channel.id, message.author.id);
  await reply(message, "success", `Ticket pris en charge par <@${message.author.id}>.`);
}

/** &ticket add <membre> — donne l'accès au ticket courant à un membre en plus de son propriétaire. */
async function addTicketMember(client, message, args) {
  if (!can(message.member, "server.tickets.manage")) return;
  const info = requireTicket(message);
  if (!info) return;

  const target = message.mentions.members?.first() || (await message.guild.members.fetch(args[0]?.replace(/\D/g, "") || "").catch(() => null));
  if (!target) return reply(message, "error", "Indique un membre (mention ou identifiant) à ajouter au ticket.");

  await message.channel
    .permissionOverwrites.edit(target.id, { ViewChannel: true, SendMessages: true })
    .catch(() => null);
  await reply(message, "success", `<@${target.id}> a maintenant accès à ce ticket.`);
}

/** &ticket remove <membre> — retire l'accès au ticket courant à un membre (jamais son propriétaire). */
async function removeTicketMember(client, message, args) {
  if (!can(message.member, "server.tickets.manage")) return;
  const info = requireTicket(message);
  if (!info) return;

  const target = message.mentions.members?.first() || (await message.guild.members.fetch(args[0]?.replace(/\D/g, "") || "").catch(() => null));
  if (!target) return reply(message, "error", "Indique un membre (mention ou identifiant) à retirer du ticket.");
  if (target.id === info.ownerId) return reply(message, "error", "Impossible de retirer le créateur de son propre ticket.");

  await message.channel.permissionOverwrites.delete(target.id).catch(() => null);
  await reply(message, "success", `<@${target.id}> n'a plus accès à ce ticket.`);
}

/** &ticket rename <nom> — renomme le ticket courant. */
async function renameTicket(client, message, args) {
  if (!can(message.member, "server.tickets.manage")) return;
  const info = requireTicket(message);
  if (!info) return;

  const nom = args.join(" ").trim().slice(0, 100);
  if (!nom) return reply(message, "error", "Indique le nouveau nom du ticket.");

  await message.channel.setName(nom).catch(() => null);
  await reply(message, "success", "Ticket renommé.");
}

/** &ticket close [raison] — équivalent en commande du bouton "Fermer". */
async function closeTicketCommand(client, message, args) {
  const info = requireTicket(message);
  if (!info) return;

  const config = ticketStore.getConfig(message.guild.id);
  if (!peutFermer(message.member, info, config)) {
    return reply(
      message,
      "error",
      config.ownerCanClose ? "Seul le demandeur ou le staff peut fermer ce ticket." : "Seul le staff peut fermer ce ticket."
    );
  }

  const raison = args.join(" ").trim() || null;
  ticketStore.unregisterTicket(message.channel.id);
  await report(client, {
    guildId: message.guild.id,
    category: "server",
    title: "Ticket fermé",
    fields: [
      { label: "Salon", value: `${message.channel.name} (${message.channel.id})` },
      ...(raison ? [{ label: "Raison", value: raison }] : []),
    ],
    action: "ticket_close",
    targetId: message.channel.id,
    targetTag: null,
    moderator: message.author,
    channelId: null,
  });

  await reply(message, "success", "Ticket fermé, ce salon va disparaître.");
  setTimeout(() => message.channel.delete("Ticket fermé").catch(() => {}), 3000);
}

async function handleTicketButton(interaction) {
  const [, action] = interaction.customId.split(":");

  if (action === "open") {
    const existing = [...interaction.guild.channels.cache.values()].find((c) => {
      const info = ticketStore.getTicketInfo(c.id);
      return info && info.ownerId === interaction.user.id;
    });
    if (existing) {
      return interaction.reply({ content: `Tu as déjà un ticket ouvert : <#${existing.id}>.`, flags: MessageFlags.Ephemeral });
    }

    const botPerm = checkBotPermission(interaction.guild, PermissionFlagsBits.ManageChannels, "ManageChannels");
    if (botPerm) return interaction.reply({ content: botPerm, flags: MessageFlags.Ephemeral });

    const { staffRoleId, closeRoleId, categoryId } = ticketStore.getConfig(interaction.guild.id);
    const overwrites = [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ];
    if (staffRoleId) overwrites.push({ id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
    // Le rôle qui peut FERMER doit forcément voir le ticket, sinon il ne
    // pourrait jamais cliquer sur le bouton.
    if (closeRoleId && closeRoleId !== staffRoleId) {
      overwrites.push({ id: closeRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });
    }

    // La catégorie n'est reprise que si elle existe encore : une catégorie
    // supprimée entre-temps ferait échouer la création, et le ticket ne
    // s'ouvrirait plus du tout.
    const categorie = categoryId && interaction.guild.channels.cache.get(categoryId);
    const channel = await interaction.guild.channels
      .create({
        name: `ticket-${interaction.user.username}`.slice(0, 100),
        type: ChannelType.GuildText,
        ...(categorie ? { parent: categorie.id } : {}),
        permissionOverwrites: overwrites,
        reason: `Ticket ouvert par ${interaction.user.tag}`,
      })
      .catch(() => null);
    if (!channel) return interaction.reply({ content: "Impossible de créer le salon du ticket.", flags: MessageFlags.Ephemeral });

    ticketStore.registerOpenTicket(channel.id, interaction.guild.id, interaction.user.id);

    await channel.send(
      card(
        "Ticket ouvert",
        `<@${interaction.user.id}>${staffRoleId ? ` — <@&${staffRoleId}>` : ""}\nDécris ta demande, le staff te répondra ici.`,
        [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${ID}:close`).setLabel("Fermer").setStyle(ButtonStyle.Danger).setEmoji(EMOJI.LOCK))]
      )
    );

    await report(interaction.client, {
      guildId: interaction.guild.id,
      category: "server",
      title: "Ticket ouvert",
      fields: [{ label: "Salon", value: `<#${channel.id}> (${channel.id})` }],
      action: "ticket_open",
      targetId: channel.id,
      targetTag: null,
      moderator: interaction.user,
      channelId: channel.id,
    });

    return interaction.reply({ content: `Ticket créé : <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
  }

  if (action === "close") {
    const info = ticketStore.getTicketInfo(interaction.channelId);
    if (!info) return interaction.reply({ content: "Ce salon n'est pas un ticket suivi par le bot.", flags: MessageFlags.Ephemeral });

    const config = ticketStore.getConfig(interaction.guild.id);
    if (!peutFermer(interaction.member, info, config)) {
      return interaction.reply({
        content: config.ownerCanClose
          ? "Seul le demandeur ou le staff peut fermer ce ticket."
          : "Seul le staff peut fermer ce ticket.",
        flags: MessageFlags.Ephemeral,
      });
    }

    ticketStore.unregisterTicket(interaction.channelId);
    await report(interaction.client, {
      guildId: interaction.guild.id,
      category: "server",
      title: "Ticket fermé",
      fields: [{ label: "Salon", value: `${interaction.channel?.name || "ticket"} (${interaction.channelId})` }],
      action: "ticket_close",
      targetId: interaction.channelId,
      targetTag: null,
      moderator: interaction.user,
      channelId: null,
    });

    await interaction.reply({ content: "Ticket fermé, ce salon va disparaître." });
    setTimeout(() => interaction.channel?.delete("Ticket fermé").catch(() => {}), 3000);
  }
}

module.exports = {
  setupTickets,
  handleTicketButton,
  claimTicket,
  addTicketMember,
  removeTicketMember,
  renameTicket,
  closeTicketCommand,
  ID,
};
