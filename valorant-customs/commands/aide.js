/**
 * `aide` — liste les commandes, avec le préfixe réellement en vigueur.
 */

const { buildSimplePanel } = require("../utils/display");
const settings = require("../utils/settings");
const access = require("../utils/access");

module.exports = {
  name: "aide",
  aliases: ["help", "commandes"],
  description: "Affiche la liste des commandes",
  usage: "aide",

  async execute(message) {
    const prefix = settings.get("prefix");
    const commands = [...message.client.commands.values()]
      // Les alias pointent sur le même module : on ne liste chaque commande qu'une fois.
      .filter((command, index, all) => all.findIndex((c) => c.name === command.name) === index)
      .filter((command) => command.name !== "panel" || access.canOpenPanel(message.author.id));

    const lines = commands.map((command) => `\`${prefix}${command.usage || command.name}\`\n-# ${command.description}`);

    return message.channel.send(buildSimplePanel({
      title: "Commandes — Customs Valorant",
      body: [
        `Préfixe actuel : \`${prefix}\``,
        "",
        lines.join("\n"),
        "",
        "-# Le reste se pilote aux boutons directement sur le panneau de la partie.",
      ].join("\n"),
    }));
  },
};
