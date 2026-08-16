const botAdminsStore = require("./botAdminsStore");
const { buildCard, payload } = require("./panelComponents");

function buildContext({ message, args, client }) {
  // Messages postés par la commande, pour que le routeur puisse les effacer
  // ensuite (voir AUTO_DELETE_MS dans utils/modMessageRouter.js).
  const sent = [];
  const track = (msg) => {
    if (msg) sent.push(msg);
    return msg;
  };

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

    sent,
    // À utiliser quand une commande poste ailleurs que par ctx.reply/ctx.send
    // (ex : `&renew`, qui répond dans le salon recréé).
    track,

    async reply(content) {
      return track(await message.reply(content).catch(() => null));
    },

    async send(content) {
      return track(await message.channel.send(content).catch(() => null));
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
