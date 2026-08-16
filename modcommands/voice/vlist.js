const { LEVEL } = require("../../utils/permLevels");
const { listField } = require("../../utils/textHelpers");

module.exports = {
  name: "vlist",
  category: "voice",
  description: "Affiche les salons vocaux occupés et qui s'y trouve",
  usage: "&vlist",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const occupied = ctx.guild.channels.cache
      .filter((c) => c.isVoiceBased() && c.members.size > 0)
      .sort((a, b) => b.members.size - a.members.size);

    if (!occupied.size) {
      await ctx.reply(ctx.card({ title: "Aucun salon vocal occupé." }));
      return;
    }

    const fields = occupied.map((channel) => ({
      name: `${channel.name} (${channel.members.size})`,
      value: listField(
        [...channel.members.values()].map((m) => {
          const marks = [m.voice.serverMute ? "muet" : null, m.voice.serverDeaf ? "sourd" : null].filter(Boolean);
          return `<@${m.id}>${marks.length ? ` — *${marks.join(", ")}*` : ""}`;
        }),
        { empty: "vide", limit: 15 }
      ),
    }));

    await ctx.reply(ctx.card({ title: `Salons vocaux occupés (${occupied.size})`, fields }));
  },
};
