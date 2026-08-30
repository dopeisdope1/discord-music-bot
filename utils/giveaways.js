const {
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
const { parseDuration } = require("./moderationCommands");
const giveawayStore = require("./giveawayStore");

const ID = "giveaway";

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

function activeCard(giveaway) {
  const endsAtS = Math.floor(giveaway.endsAt / 1000);
  return card(
    "Giveaway",
    [
      `**Lot :** ${giveaway.prize}`,
      `**Se termine :** <t:${endsAtS}:R> (<t:${endsAtS}:f>)`,
      `**Participants :** ${giveaway.participants.length}`,
      `**Organisé par :** <@${giveaway.hostId}>`,
    ].join("\n"),
    [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${ID}:join`).setLabel("Participer").setStyle(ButtonStyle.Primary))]
  );
}

/** &giveaway start <durée> <lot> — ex: `giveaway start 1h Nitro`. */
async function startGiveaway(client, message, args) {
  if (!can(message.member, "server.giveaways.manage")) return;
  const ms = parseDuration(args[0]);
  if (!ms) return message.reply({ embeds: [buildStatusEmbed("error", "Indique une durée valide : `10m`, `1h`, `1d` (max 28 jours).")] });
  const prize = args.slice(1).join(" ").trim();
  if (!prize) return message.reply({ embeds: [buildStatusEmbed("error", "Indique le lot : `giveaway start 1h Nitro`.")] });

  const endsAt = Date.now() + ms;
  const giveaway = { messageId: null, guildId: message.guild.id, channelId: message.channel.id, prize, endsAt, hostId: message.author.id };
  const sent = await message.channel.send(card("Giveaway", `**Lot :** ${prize}\n**Se termine :** <t:${Math.floor(endsAt / 1000)}:R>`)).catch(() => null);
  if (!sent) return;
  giveaway.messageId = sent.id;
  giveawayStore.create(giveaway);
  await sent.edit(activeCard(giveawayStore.get(sent.id))).catch(() => {});
}

async function handleGiveawayButton(interaction) {
  const [, action] = interaction.customId.split(":");
  if (action !== "join") return;

  const giveaway = giveawayStore.get(interaction.message.id);
  if (!giveaway || giveaway.ended) {
    return interaction.reply({ content: "Ce giveaway est terminé.", flags: MessageFlags.Ephemeral });
  }

  const joined = giveawayStore.toggleParticipant(interaction.message.id, interaction.user.id);
  await interaction.reply({ content: joined ? "Tu participes !" : "Tu ne participes plus.", flags: MessageFlags.Ephemeral });
  await interaction.message.edit(activeCard(giveawayStore.get(interaction.message.id))).catch(() => {});
}

function pickWinner(participants) {
  if (!participants.length) return null;
  return participants[Math.floor(Math.random() * participants.length)];
}

/** À appeler périodiquement (voir index.js) : termine les giveaways expirés et tire un gagnant. */
async function checkExpiredGiveaways(client) {
  for (const giveaway of giveawayStore.getExpiredActive()) {
    const winnerId = pickWinner(giveaway.participants);
    giveawayStore.markEnded(giveaway.messageId, winnerId);

    const channel = client.channels.cache.get(giveaway.channelId);
    if (!channel?.isTextBased()) continue;

    const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
    if (message) {
      await message
        .edit(
          card(
            "Giveaway terminé",
            [`**Lot :** ${giveaway.prize}`, winnerId ? `**Gagnant :** <@${winnerId}>` : "**Aucun participant.**"].join("\n")
          )
        )
        .catch(() => {});
    }
    if (winnerId) {
      await channel
        .send({ content: `<@${winnerId}> a gagné **${giveaway.prize}** !`, allowedMentions: { users: [winnerId] } })
        .catch(() => {});
    }
  }
}

/** &giveaway reroll [id du message] — retire un nouveau gagnant du dernier giveaway du salon. */
async function rerollGiveaway(client, message, args) {
  if (!can(message.member, "server.giveaways.manage")) return;
  const giveaway = args[0] ? giveawayStore.get(args[0]) : giveawayStore.getLatestInChannel(message.channel.id);
  if (!giveaway) return message.reply({ embeds: [buildStatusEmbed("error", "Aucun giveaway trouvé dans ce salon.")] });

  const winnerId = pickWinner(giveaway.participants);
  giveawayStore.markEnded(giveaway.messageId, winnerId);
  if (!winnerId) return message.reply({ embeds: [buildStatusEmbed("info", "Aucun participant, personne à tirer au sort.")] });

  await message.channel.send({ content: `Nouveau tirage : <@${winnerId}> remporte **${giveaway.prize}** !`, allowedMentions: { users: [winnerId] } });
}

module.exports = { startGiveaway, handleGiveawayButton, checkExpiredGiveaways, rerollGiveaway, ID };
