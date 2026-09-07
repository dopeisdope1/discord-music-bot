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
const { EMOJI } = require("./emojis");
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

/** Gagnants d'un giveaway, en tolérant les entrées d'avant le multi-gagnant. */
function winnersOf(giveaway) {
  if (giveaway.winnerIds) return giveaway.winnerIds;
  return giveaway.winnerId ? [giveaway.winnerId] : [];
}

function activeCard(giveaway) {
  const endsAtS = Math.floor(giveaway.endsAt / 1000);
  const winnersCount = giveaway.winnersCount ?? 1;
  return card(
    "Giveaway",
    [
      `**Lot :** ${giveaway.prize}`,
      `**Se termine :** <t:${endsAtS}:R> (<t:${endsAtS}:f>)`,
      winnersCount > 1 ? `**Gagnants tirés :** ${winnersCount}` : null,
      giveaway.requiredRoleId ? `**Réservé au rôle :** <@&${giveaway.requiredRoleId}>` : null,
      `**Participants :** ${giveaway.participants.length}`,
      `**Organisé par :** <@${giveaway.hostId}>`,
    ]
      .filter(Boolean)
      .join("\n"),
    [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${ID}:join`).setLabel("Participer").setStyle(ButtonStyle.Primary).setEmoji(EMOJI.CROWN))]
  );
}

/**
 * &giveaway start <durée> <lot> — ex: `giveaway start 1h Nitro`.
 *
 * `options` (nombre de gagnants, rôle requis) n'existe que pour la carte
 * interactive (voir utils/commandForms.js) : la commande tapée garde
 * exactement sa syntaxe d'origine — un gagnant, ouvert à tout le monde —
 * plutôt que d'inventer des drapeaux texte que personne n'a demandés.
 *
 * @param {{ winnersCount?: number, requiredRoleId?: string|null }} [options]
 */
async function startGiveaway(client, message, args, options = {}) {
  if (!can(message.member, "server.giveaways.manage")) return;
  const ms = parseDuration(args[0]);
  if (!ms) return message.reply({ embeds: [buildStatusEmbed("error", "Indique une durée valide : `10m`, `1h`, `1d` (max 28 jours).")] });
  const prize = args.slice(1).join(" ").trim();
  if (!prize) return message.reply({ embeds: [buildStatusEmbed("error", "Indique le lot : `giveaway start 1h Nitro`.")] });

  const winnersCount = Math.min(Math.max(1, parseInt(options.winnersCount, 10) || 1), MAX_WINNERS);
  const endsAt = Date.now() + ms;
  const giveaway = {
    messageId: null,
    guildId: message.guild.id,
    channelId: message.channel.id,
    prize,
    endsAt,
    hostId: message.author.id,
    winnersCount,
    requiredRoleId: options.requiredRoleId || null,
  };
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

  // Le filtre est vérifié à CHAQUE clic, pas seulement au premier : quelqu'un
  // qui perd le rôle entre-temps ne doit plus pouvoir rejoindre.
  if (giveaway.requiredRoleId && !interaction.member?.roles?.cache?.has(giveaway.requiredRoleId)) {
    return interaction.reply({
      content: `Ce giveaway est réservé aux membres ayant <@&${giveaway.requiredRoleId}>.`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  }

  const joined = giveawayStore.toggleParticipant(interaction.message.id, interaction.user.id);
  await interaction.reply({ content: joined ? "Tu participes !" : "Tu ne participes plus.", flags: MessageFlags.Ephemeral });
  await interaction.message.edit(activeCard(giveawayStore.get(interaction.message.id))).catch(() => {});
}

const MAX_WINNERS = 20;

/**
 * Tire `count` gagnants DISTINCTS au hasard — on retire chaque tiré du lot,
 * sinon la même personne pourrait remporter deux fois le même giveaway. Moins
 * de gagnants que demandé s'il n'y a pas assez de participants.
 */
function pickWinners(participants, count = 1) {
  const pool = [...participants];
  const winners = [];
  const target = Math.min(Math.max(1, count), pool.length);
  while (winners.length < target) winners.push(...pool.splice(Math.floor(Math.random() * pool.length), 1));
  return winners;
}

/** Termine un giveaway (déjà marqué "ended" côté store), édite sa carte et annonce le(s) gagnant(s). */
async function finishGiveaway(client, giveaway, winnerIds) {
  const channel = client.channels.cache.get(giveaway.channelId);
  if (!channel?.isTextBased()) return;

  const winners = Array.isArray(winnerIds) ? winnerIds : winnerIds ? [winnerIds] : [];
  const mentions = winners.map((id) => `<@${id}>`).join(", ");

  const message = await channel.messages.fetch(giveaway.messageId).catch(() => null);
  if (message) {
    await message
      .edit(
        card(
          "Giveaway terminé",
          [`**Lot :** ${giveaway.prize}`, winners.length ? `**Gagnant${winners.length > 1 ? "s" : ""} :** ${mentions}` : "**Aucun participant.**"].join("\n")
        )
      )
      .catch(() => {});
  }
  if (winners.length) {
    await channel
      .send({ content: `${mentions} ${winners.length > 1 ? "ont gagné" : "a gagné"} **${giveaway.prize}** !`, allowedMentions: { users: winners } })
      .catch(() => {});
  }
}

/** À appeler périodiquement (voir index.js) : termine les giveaways expirés et tire un gagnant. */
async function checkExpiredGiveaways(client) {
  for (const giveaway of giveawayStore.getExpiredActive()) {
    const winnerIds = pickWinners(giveaway.participants, giveaway.winnersCount ?? 1);
    giveawayStore.markEnded(giveaway.messageId, winnerIds);
    await finishGiveaway(client, giveaway, winnerIds);
  }
}

/** &end giveaway <id> — termine un giveaway avant son échéance naturelle. */
async function endGiveaway(client, message, args) {
  if (!can(message.member, "server.giveaways.manage")) return;
  const giveaway = args[0] ? giveawayStore.get(args[0]) : giveawayStore.getLatestInChannel(message.channel.id);
  if (!giveaway) return message.reply({ embeds: [buildStatusEmbed("error", "Aucun giveaway trouvé (indique son ID, visible dans `giveaway reroll`).")] });
  if (giveaway.ended) return message.reply({ embeds: [buildStatusEmbed("info", "Ce giveaway est déjà terminé.")] });

  const winnerIds = pickWinners(giveaway.participants, giveaway.winnersCount ?? 1);
  giveawayStore.markEnded(giveaway.messageId, winnerIds);
  await finishGiveaway(client, giveaway, winnerIds);
}

/** &giveaway reroll [id du message] — retire un nouveau gagnant du dernier giveaway du salon. */
async function rerollGiveaway(client, message, args) {
  if (!can(message.member, "server.giveaways.manage")) return;
  const giveaway = args[0] ? giveawayStore.get(args[0]) : giveawayStore.getLatestInChannel(message.channel.id);
  if (!giveaway) return message.reply({ embeds: [buildStatusEmbed("error", "Aucun giveaway trouvé dans ce salon.")] });

  const winnerIds = pickWinners(giveaway.participants, giveaway.winnersCount ?? 1);
  giveawayStore.markEnded(giveaway.messageId, winnerIds);
  if (!winnerIds.length) return message.reply({ embeds: [buildStatusEmbed("info", "Aucun participant, personne à tirer au sort.")] });

  const mentions = winnerIds.map((id) => `<@${id}>`).join(", ");
  await message.channel.send({
    content: `Nouveau tirage : ${mentions} ${winnerIds.length > 1 ? "remportent" : "remporte"} **${giveaway.prize}** !`,
    allowedMentions: { users: winnerIds },
  });
}

module.exports = { startGiveaway, handleGiveawayButton, checkExpiredGiveaways, rerollGiveaway, endGiveaway, pickWinners, winnersOf, MAX_WINNERS, ID };
