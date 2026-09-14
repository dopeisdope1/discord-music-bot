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

const ID = "poll";
const MAX_OPTIONS = 5; // tient sur une seule ligne de boutons

// Votes en mémoire, par message de sondage : Map<messageId, { question, options: string[], votes: Map<userId, optionIndex> }>
// Une réouverture du bot remet les sondages à zéro — acceptable, un sondage
// est une activité ponctuelle et courte, pas une donnée à conserver.
const polls = new Map();

/** Découpe "a" "b" "c" en un tableau de chaînes (guillemets doubles obligatoires). */
function parseQuoted(text) {
  const matches = [...text.matchAll(/"([^"]+)"/g)];
  return matches.map((m) => m[1].trim()).filter(Boolean);
}

/** @param {{ question: string, options: string[], votes: Map<string, number> }} poll */
function buildPollCard(poll) {
  const total = poll.votes.size;
  const counts = poll.options.map((_, i) => [...poll.votes.values()].filter((v) => v === i).length);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${poll.question}`));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  const lines = poll.options.map((opt, i) => {
    const pct = total ? Math.round((counts[i] / total) * 100) : 0;
    const bar = "█".repeat(Math.round(pct / 10)).padEnd(10, "░");
    return `**${i + 1}.** ${opt} — ${counts[i]} vote(s) (${pct}%)\n${bar}`;
  });
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${lines.join("\n\n")}\n\n**Total : ${total} vote(s)**`));

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      poll.options.map((opt, i) => new ButtonBuilder().setCustomId(`${ID}:vote:${i}`).setLabel(`${i + 1}`).setStyle(ButtonStyle.Secondary))
    )
  );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** &poll "question" "option1" "option2" [...] (2 à 5 options). */
async function createPoll(client, message, args) {
  if (!can(message.member, "server.polls.manage")) return;
  const parts = parseQuoted(args.join(" "));
  if (parts.length < 3) {
    return message.reply({
      embeds: [buildStatusEmbed("error", 'Utilise : `poll "question" "option1" "option2" [...]` (2 à 5 options, guillemets obligatoires).')],
    });
  }
  const [question, ...options] = parts;
  if (options.length > MAX_OPTIONS) {
    return message.reply({ embeds: [buildStatusEmbed("error", `Maximum ${MAX_OPTIONS} options.`)] });
  }

  const poll = { question, options, votes: new Map() };
  const sent = await message.channel.send(buildPollCard(poll)).catch(() => null);
  if (!sent) return;
  polls.set(sent.id, poll);
}

async function handlePollButton(interaction) {
  const [, action, indexStr] = interaction.customId.split(":");
  if (action !== "vote") return;
  const poll = polls.get(interaction.message.id);
  if (!poll) return interaction.reply({ content: "Ce sondage n'est plus actif (redémarrage du bot).", flags: MessageFlags.Ephemeral });

  poll.votes.set(interaction.user.id, parseInt(indexStr, 10));
  await interaction.update(buildPollCard(poll));
}

module.exports = { createPoll, handlePollButton, parseQuoted, ID };
