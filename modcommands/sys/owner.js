const { LEVEL } = require("../../utils/permLevels");
const { UsageError, BotError } = require("../../utils/modErrors");
const { extractUserId } = require("../../utils/argParsing");
const botAdminsStore = require("../../utils/botAdminsStore");
const { listField } = require("../../utils/textHelpers");

module.exports = {
  name: "owner",
  category: "sys",
  description: "Gère les owners du bot",
  usage: "&owner [add|remove] [@mention] [sys|super_sys]",
  level: LEVEL.SYS,
  async execute(ctx) {
    const sub = (ctx.args[0] || "").toLowerCase();

    if (sub !== "add" && sub !== "remove") {
      const admins = botAdminsStore.list();
      await ctx.reply(
        ctx.card({
          title: "Owners du bot",
          description: listField(admins.map((a) => `<@${a.userId}> — \`${a.tier}\``), { empty: "Aucun owner configuré." }),
        })
      );
      return;
    }

    const targetId = extractUserId(ctx.args[1]);
    if (!targetId) throw new UsageError(this.usage);

    if (sub === "add") {
      const tier = ctx.args[2] === "super_sys" ? "super_sys" : "sys";
      if (tier === "super_sys" && !ctx.isSuperSys) {
        throw new BotError("Seul un owner super_sys peut promouvoir quelqu'un en super_sys.");
      }
      botAdminsStore.add(targetId, tier);
      await ctx.reply(ctx.card({ title: `<@${targetId}> est désormais \`${tier}\`.` }));
    } else {
      botAdminsStore.remove(targetId);
      await ctx.reply(ctx.card({ title: `<@${targetId}> n'est plus owner.` }));
    }
  },
};
