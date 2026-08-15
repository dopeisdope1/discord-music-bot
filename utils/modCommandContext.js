const botAdminsStore = require("./botAdminsStore");
const { buildCard, payload } = require("./panelComponents");

function buildContext({ message, args, client }) {
  return {
    message,
    args,
    client,
    guildId: message.guild.id,
    guild: message.guild,
    member: message.member,
    author: message.author,
    isSuperSys: botAdminsStore.isSuperSys(message.author.id),
    isSysOrAbove: botAdminsStore.isSysOrAbove(message.author.id),

    reply(content) {
      return message.reply(content).catch(() => null);
    },

    send(content) {
      return message.channel.send(content).catch(() => null);
    },

    // Carte Components V2 prête à envoyer : `await ctx.reply(ctx.card({ title, description, fields, thumbnail, image }))`.
    // `fields` prend la même forme `{ name, value }` que les embeds classiques.
    card(opts = {}) {
      return payload(
        buildCard({
          title: opts.title,
          description: opts.description,
          fields: opts.fields || [],
          thumbnail: opts.thumbnail,
          image: opts.image,
        })
      );
    },
  };
}

module.exports = { buildContext };
