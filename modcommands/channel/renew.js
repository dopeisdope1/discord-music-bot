const { LEVEL } = require("../../utils/permLevels");
const { sendLog } = require("../../utils/actionLogger");

module.exports = {
  name: "renew",
  category: "channel",
  description: "Recrée le salon à l'identique (vide l'historique)",
  usage: "&renew",
  level: LEVEL.CONFIGURABLE,
  async execute(ctx) {
    const channel = ctx.message.channel;
    const clone = await channel.clone({ reason: `Renouvelé par ${ctx.author.tag}` });
    await clone.setPosition(channel.position);
    await channel.delete(`Renouvelé par ${ctx.author.tag}`).catch(() => {});

    sendLog(ctx.client, ctx.guildId, "salon", { title: "Renew", description: `#${clone.name} renouvelé.`, actor: ctx.author });
    // `ctx.track` : le salon d'origine ayant été supprimé, on répond dans le
    // clone — hors de ctx.send, donc à signaler pour l'effacement automatique.
    ctx.track(await clone.send(ctx.card({ title: "Salon renouvelé." })).catch(() => null));
  },
};
