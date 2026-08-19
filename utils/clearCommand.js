const { PermissionFlagsBits } = require("discord.js");
const { getPrefixes } = require("./prefixStore");
const { waitForHydration } = require("./configChannel");
const { extractUserId } = require("./argParsing");
const { randomClearJoke } = require("./jokes");
const { deleteMessages } = require("./deleteMessages");
const { buildStatusEmbed } = require("./statusEmbed");

const USAGE = "&clear [nombre] | &clear <@mention | id | username> [nombre]";

/**
 * `&clear` autonome — seule commande de modération conservée après le retrait
 * du moteur "zinki" : pas de niveaux de permission ni de panel, juste la
 * permission Discord native "Gérer les messages".
 */
async function handleClearCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  await waitForHydration(message.guild.id);
  const prefix = `${getPrefixes(message.guild.id).musicMod}clear`;
  if (!message.content.toLowerCase().startsWith(prefix.toLowerCase())) return;

  if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  const args = message.content
    .slice(prefix.length)
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  const first = args[0];
  const userId = first ? extractUserId(first) : null;
  const byUsername = first && !userId ? first : null;

  let amount;
  let targetId = userId;

  if (userId || byUsername) {
    amount = Number(args[1]) || 100;
    if (byUsername) {
      await message.guild.members.fetch();
      const member = message.guild.members.cache.find((m) => m.user.username === byUsername);
      targetId = member?.id || null;
    }
  } else {
    amount = Number(first);
  }

  if (!Number.isInteger(amount) || amount <= 0 || amount > 100) {
    const warning = await message.reply({ embeds: [buildStatusEmbed("error", `Utilisation : \`${USAGE}\``)] }).catch(() => null);
    if (warning) setTimeout(() => warning.delete().catch(() => {}), 5_000);
    return;
  }

  const messages = await message.channel.messages.fetch({ limit: 100 });
  let toDelete = [...messages.values()].filter((m) => m.id !== message.id);
  if (targetId) toDelete = toDelete.filter((m) => m.author.id === targetId);
  toDelete = toDelete.slice(0, amount);

  const count = toDelete.length ? await deleteMessages(message.channel, toDelete) : 0;
  await message.delete().catch(() => {});

  const sent = await message.channel
    .send({ embeds: [buildStatusEmbed("success", `**${count}** supprimé(s) — ${randomClearJoke()}`)] })
    .catch(() => null);
  if (sent) setTimeout(() => sent.delete().catch(() => {}), 5_000);
}

module.exports = { handleClearCommand };
