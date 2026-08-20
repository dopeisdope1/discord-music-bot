const { buildStatusEmbed } = require("./statusEmbed");

// Commandes publiques d'affichage : accessibles à tout le monde, sans effet
// sur le serveur (elles ne font que lire et présenter des informations).

/** Membre visé : mention, ID brut, ou l'auteur du message par défaut. */
async function resolveTarget(message, args) {
  const mentioned = message.mentions.users?.first();
  if (mentioned) return mentioned;

  const rawId = args[0]?.replace(/\D/g, "");
  if (rawId && rawId.length >= 15) {
    const fetched = await message.client.users.fetch(rawId).catch(() => null);
    if (fetched) return fetched;
  }
  return message.author;
}

const handlers = {
  async pic(client, message, args) {
    const user = await resolveTarget(message, args);
    const url = user.displayAvatarURL({ size: 512 });
    await message.reply({
      embeds: [buildStatusEmbed("info", `Avatar de **${user.tag}**`, { image: url })],
    });
  },

  async banner(client, message, args) {
    const user = await resolveTarget(message, args);
    // La bannière n'est pas incluse dans l'objet User du cache : il faut la
    // demander explicitement à l'API, d'où le force.
    const full = await client.users.fetch(user.id, { force: true }).catch(() => null);
    const url = full?.bannerURL({ size: 1024 });

    if (!url) {
      return message.reply({
        embeds: [buildStatusEmbed("error", `**${user.tag}** n'a pas de bannière.`)],
      });
    }
    await message.reply({
      embeds: [buildStatusEmbed("info", `Bannière de **${user.tag}**`, { image: url })],
    });
  },

  async server(client, message) {
    const guild = message.guild;
    const owner = await guild.fetchOwner().catch(() => null);
    const bots = guild.members.cache.filter((m) => m.user.bot).size;

    await message.reply({
      embeds: [
        buildStatusEmbed("info", null, {
          title: guild.name,
          thumbnail: guild.iconURL({ size: 256 }) || undefined,
          fields: [
            { name: "Propriétaire", value: owner ? `<@${owner.id}>` : "inconnu", inline: true },
            { name: "Membres", value: String(guild.memberCount), inline: true },
            { name: "Bots", value: String(bots), inline: true },
            { name: "Salons", value: String(guild.channels.cache.size), inline: true },
            { name: "Rôles", value: String(guild.roles.cache.size), inline: true },
            { name: "Boosts", value: String(guild.premiumSubscriptionCount ?? 0), inline: true },
            { name: "Créé le", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>` },
          ],
        }),
      ],
    });
  },

  async snipe(client, message) {
    const sniped = client.snipes?.get(message.channel.id);
    if (!sniped) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Aucun message supprimé récemment dans ce salon.")],
      });
    }

    await message.reply({
      embeds: [
        buildStatusEmbed("info", sniped.content, {
          title: `Dernier message supprimé — ${sniped.authorTag}`,
          thumbnail: sniped.authorAvatar || undefined,
          fields: [{ name: "Supprimé", value: `<t:${Math.floor(sniped.deletedAt / 1000)}:R>` }],
        }),
      ],
    });
  },
};

module.exports = { publicHandlers: handlers };
