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
          new ButtonBuilder().setCustomId(`${ID}:open`).setLabel("Ouvrir un ticket").setStyle(ButtonStyle.Primary)
        ),
      ]
    )
  );
  await reply(message, "success", "Message de tickets envoyé dans ce salon.");
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

    const { staffRoleId } = ticketStore.getConfig(interaction.guild.id);
    const overwrites = [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
    ];
    if (staffRoleId) overwrites.push({ id: staffRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] });

    const channel = await interaction.guild.channels
      .create({
        name: `ticket-${interaction.user.username}`.slice(0, 100),
        type: ChannelType.GuildText,
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
        [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${ID}:close`).setLabel("Fermer").setStyle(ButtonStyle.Danger))]
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

    const { staffRoleId } = ticketStore.getConfig(interaction.guild.id);
    const isStaff = staffRoleId && interaction.member.roles.cache.has(staffRoleId);
    if (interaction.user.id !== info.ownerId && !isStaff && !can(interaction.member, "server.tickets.manage")) {
      return interaction.reply({ content: "Seul le demandeur ou le staff peut fermer ce ticket.", flags: MessageFlags.Ephemeral });
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

module.exports = { setupTickets, handleTicketButton, ID };
