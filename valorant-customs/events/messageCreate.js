/**
 * Commandes préfixe. Le préfixe est lu à CHAQUE message : le changer depuis le
 * panneau prend effet immédiatement, sans redémarrage.
 *
 * Nécessite l'intent privilégié « Message Content » (portail développeur).
 */

const { Events } = require("discord.js");

const settings = require("../utils/settings");
const { errorEmbed } = require("../utils/embeds");

module.exports = {
  name: Events.MessageCreate,

  async execute(message) {
    if (message.author.bot || !message.guild) return;

    const prefix = settings.get("prefix");
    if (!prefix || !message.content.startsWith(prefix)) return;

    const [name, ...args] = message.content.slice(prefix.length).trim().split(/\s+/);
    if (!name) return;

    const command = message.client.commands.get(name.toLowerCase());
    if (!command) return; // pas une commande du bot : on ignore en silence

    try {
      await command.execute(message, args);
    } catch (error) {
      console.error(`[commande] ${prefix}${name} a échoué :`, error);
      await message.reply({
        embeds: [errorEmbed("Une erreur inattendue est survenue. L'incident a été enregistré côté serveur.")],
        allowedMentions: { parse: [], repliedUser: false },
      }).catch(() => {});
    }
  },
};
