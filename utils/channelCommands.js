const { PermissionFlagsBits } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");

// Commandes agissant sur le salon courant. L'autorisation est vérifiée en
// amont par le routeur (voir utils/musicCommands.js, portée "salon").

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });

/** Vrai si le bot possède la permission, sinon répond et renvoie faux. */
async function requireBotPermission(message, flag, label) {
  if (message.guild.members.me.permissions.has(flag)) return true;
  await reply(message, "error", `Il me manque la permission **${label}**.`);
  return false;
}

/**
 * Modifie une permission de @everyone sur le salon courant.
 * `false` interdit, `null` remet la valeur héritée de la catégorie/du rôle.
 */
async function setEveryonePermission(message, key, value, { done, already, failed }) {
  if (!(await requireBotPermission(message, PermissionFlagsBits.ManageRoles, "Gérer les rôles"))) return;

  const everyone = message.guild.roles.everyone;
  const current = message.channel.permissionOverwrites.cache.get(everyone.id);
  const currentlyDenied = current?.deny.has(key);

  // `null` (rétablissement) n'a de sens que si la permission est bien refusée
  // en ce moment : sinon on annonce un changement qui n'a pas lieu.
  if (value === null && !currentlyDenied) return reply(message, "info", already);
  if (value === false && currentlyDenied) return reply(message, "info", already);

  try {
    await message.channel.permissionOverwrites.edit(everyone, { [key]: value });
    await reply(message, "success", done);
  } catch (err) {
    console.error("[channelCommands] échec de la modification des permissions :", err);
    await reply(message, "error", failed);
  }
}

const handlers = {
  async lock(client, message) {
    await setEveryonePermission(message, "SendMessages", false, {
      done: "Salon verrouillé : plus personne ne peut écrire ici.",
      already: "Ce salon est déjà verrouillé.",
      failed: "Impossible de verrouiller ce salon.",
    });
  },

  async unlock(client, message) {
    await setEveryonePermission(message, "SendMessages", null, {
      done: "Salon déverrouillé.",
      already: "Ce salon n'est pas verrouillé.",
      failed: "Impossible de déverrouiller ce salon.",
    });
  },

  async hide(client, message) {
    await setEveryonePermission(message, "ViewChannel", false, {
      done: "Salon masqué.",
      already: "Ce salon est déjà masqué.",
      failed: "Impossible de masquer ce salon.",
    });
  },

  async unhide(client, message) {
    await setEveryonePermission(message, "ViewChannel", null, {
      done: "Salon de nouveau visible.",
      already: "Ce salon n'est pas masqué.",
      failed: "Impossible de rendre ce salon visible.",
    });
  },

  // Supprime le salon et le recrée à l'identique : c'est la façon la plus
  // rapide de le vider entièrement, l'historique partant avec l'ancien salon.
  // Irréversible, d'où la vérification de permission avant toute action.
  async renew(client, message) {
    if (!(await requireBotPermission(message, PermissionFlagsBits.ManageChannels, "Gérer les salons"))) return;

    const channel = message.channel;
    const position = channel.position;

    try {
      const clone = await channel.clone({ reason: `Renouvellement demandé par ${message.author.tag}` });
      await clone.setPosition(position).catch(() => {});
      await channel.delete(`Renouvellement demandé par ${message.author.tag}`);
      // La confirmation part dans le NOUVEAU salon : l'ancien n'existe plus.
      await clone.send({
        embeds: [buildStatusEmbed("success", `Salon recréé à neuf par ${message.author}.`)],
      });
    } catch (err) {
      console.error("[channelCommands] échec du renouvellement :", err);
      await reply(message, "error", "Impossible de recréer ce salon.").catch(() => {});
    }
  },
};

module.exports = { channelHandlers: handlers };
