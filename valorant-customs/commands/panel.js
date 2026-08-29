/**
 * `panel` — ouvre le panneau de contrôle.
 *
 * Une commande préfixe ne peut pas répondre en éphémère : le bot poste donc un
 * petit panneau avec un bouton « Ouvrir le panneau ». Le clic, lui, est une
 * interaction — la réponse est alors **strictement privée**, visible de toi
 * seul. Les non-autorisés qui cliquent reçoivent un refus, tout aussi privé.
 */

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

const access = require("../utils/access");
const settings = require("../utils/settings");
const { buildSimplePanel } = require("../utils/display");
const { OPEN_BUTTON_ID } = require("../utils/panel");
const { replyError } = require("../utils/reply");

module.exports = {
  name: "panel",
  aliases: ["panneau", "admin"],
  description: "Ouvre le panneau de contrôle (propriétaires du bot)",
  usage: "panel",
  tier: "owner",

  async execute(message) {
    if (!access.canOpenPanel(message.author.id)) {
      // Message volontairement neutre : inutile d'annoncer qui est propriétaire.
      return replyError(message, "Cette commande est réservée aux propriétaires du bot.");
    }

    // Le message de commande disparaît : le salon reste propre.
    await message.delete().catch(() => {});

    return message.channel.send(buildSimplePanel({
      title: "⚙️ Panneau de contrôle",
      body: [
        `Préfixe actuel · \`${settings.get("prefix")}\``,
        "-# Seuls les propriétaires du bot peuvent l'ouvrir. Le panneau s'affiche en privé, visible de toi seul.",
      ].join("\n"),
      rows: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(OPEN_BUTTON_ID)
            .setLabel("Ouvrir le panneau")
            .setEmoji("⚙️")
            .setStyle(ButtonStyle.Secondary),
        ),
      ],
    }));
  },
};
