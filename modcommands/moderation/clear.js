const { LEVEL } = require("../../utils/permLevels");
const { UsageError } = require("../../utils/modErrors");
const { extractUserId } = require("../../utils/argParsing");
const { sendLog } = require("../../utils/actionLogger");
const { buildStatusEmbed } = require("../../utils/statusEmbed");
const { randomClearJoke } = require("../../utils/jokes");
const { deleteMessages } = require("../../utils/deleteMessages");

module.exports = {
  name: "clear",
  category: "moderation",
  description: "Supprime des messages dans le salon (max 100)",
  usage: "&clear [nombre] | clear <@mention | id | username> [nombre]",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const first = ctx.args[0];
    const userId = first ? extractUserId(first) : null;
    const byUsername = first && !userId ? first : null;

    let amount;
    let targetId = userId;

    if (userId || byUsername) {
      amount = Number(ctx.args[1]) || 100;
      if (byUsername) {
        await ctx.guild.members.fetch();
        const member = ctx.guild.members.cache.find((m) => m.user.username === byUsername);
        targetId = member?.id || null;
      }
    } else {
      amount = Number(first);
    }

    if (!Number.isInteger(amount) || amount <= 0 || amount > 100) throw new UsageError(this.usage);

    const messages = await ctx.message.channel.messages.fetch({ limit: 100 });
    let toDelete = [...messages.values()].filter((m) => m.id !== ctx.message.id);
    if (targetId) toDelete = toDelete.filter((m) => m.author.id === targetId);
    toDelete = toDelete.slice(0, amount);

    const count = toDelete.length ? await deleteMessages(ctx.message.channel, toDelete) : 0;
    await ctx.message.delete().catch(() => {});

    sendLog(ctx.client, ctx.guildId, "moderation", {
      title: "Clear",
      description: `${count} message(s) supprimé(s) dans <#${ctx.message.channel.id}>.`,
      actor: ctx.author,
    });

    const confirm = await ctx.send({
      embeds: [buildStatusEmbed("success", `**${count}** supprimé(s) — ${randomClearJoke()}`)],
    });
    setTimeout(() => confirm?.delete().catch(() => {}), 15_000);
  },
};
