const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, PermissionFlagsBits, MessageFlags } = require("discord.js");
const { can } = require("./permissions/engine");
const { checkBotPermission, report } = require("./moderation/actions");

// "-unbanall" (confirmation obligatoire, comme -banall) — porté depuis
// utils/serverExtra.js du bot principal, MAIS sans dépendre de son système
// générique de confirmation (utils/serverAdminCommands.js::
// requestConfirmation, partagé avec des dizaines de commandes hors
// périmètre) : confirmation autonome, même patron que utils/banAll.js.
const ID = "unbanall";

const pending = new Map();
const PENDING_TTL_MS = 15 * 60 * 1000;

function rememberRequest(data) {
  const now = Date.now();
  for (const [key, value] of pending) {
    if (now - value.at > PENDING_TTL_MS) pending.delete(key);
  }
  const token = `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  pending.set(token, { ...data, at: now });
  return token;
}

function card(guildId, title, body, rows = []) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`));
  if (body) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  }
  if (rows.length) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    for (const row of rows) container.addActionRowComponents(row);
  }
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

async function unbanall(client, message) {
  if (!can(message.member, "moderation.unbanall")) return;
  const botPerm = checkBotPermission(message.guild, PermissionFlagsBits.BanMembers, "BanMembers");
  if (botPerm) return message.reply(card(message.guild.id, "Action impossible", botPerm));

  const bans = await message.guild.bans.fetch().catch(() => null);
  if (!bans || !bans.size) return message.reply(card(message.guild.id, "Débannissement de masse", "Personne n'est banni."));

  const token = rememberRequest({ actorId: message.author.id, count: bans.size });

  return message.reply(
    card(message.guild.id, 
      "Confirmer le débannissement de masse",
      `**${bans.size}** membre(s) actuellement banni(s) seront débannis. Cette action ne peut pas être annulée automatiquement.`,
      [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${ID}:go:${token}`).setLabel("Débannir tout le monde").setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`${ID}:no:${token}`).setLabel("Annuler").setStyle(ButtonStyle.Secondary)
        ),
      ]
    )
  );
}

async function handleUnbanAllInteraction(interaction) {
  const [, action, token] = interaction.customId.split(":");

  if (!can(interaction.member, "moderation.unbanall")) {
    return interaction.reply({ content: "Tu n'as pas accès à cette commande.", flags: MessageFlags.Ephemeral });
  }

  const request = pending.get(token);
  if (!request) {
    return interaction.update(card(interaction.guild.id, "Panneau expiré", "Relance la commande pour recommencer."));
  }
  if (interaction.user.id !== request.actorId) {
    return interaction.reply({ content: "Ce panneau n'est pas le tien.", flags: MessageFlags.Ephemeral });
  }

  if (action === "no") {
    pending.delete(token);
    return interaction.update(card(interaction.guild.id, "Débannissement de masse annulé", null));
  }

  if (action !== "go") return;
  pending.delete(token);

  await interaction.update(card(interaction.guild.id, "Débannissement de masse en cours", "…"));

  const currentBans = await interaction.guild.bans.fetch().catch(() => null);
  let count = 0;
  for (const ban of currentBans?.values() || []) {
    await interaction.guild.members.unban(ban.user.id, `Débannissement de masse par ${interaction.user.tag}`).catch(() => {});
    count++;
  }

  await report(interaction.client, {
    guildId: interaction.guild.id,
    title: "Débannissement de masse",
    fields: [{ label: "Membres débannis", value: String(count) }],
    action: "unbanall",
    targetId: null,
    targetTag: null,
    moderator: interaction.user,
    channelId: interaction.channelId,
    extra: { count },
  });

  await interaction.message.edit(card(interaction.guild.id, "Terminé", `**${count}** membre(s) débanni(s).`)).catch(() => {});
}

module.exports = { unbanall, handleUnbanAllInteraction, ID };
