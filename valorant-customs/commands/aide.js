/**
 * `aide` — liste les commandes, avec le préfixe réellement en vigueur.
 *
 * L'aide s'adapte à celui qui la demande : elle affiche son rang, et la section
 * réservée aux propriétaires n'apparaît que pour eux — inutile d'exposer
 * l'existence du panneau à tout le serveur.
 */

const { buildSimplePanel } = require("../utils/display");
const settings = require("../utils/settings");
const access = require("../utils/access");

// Ordre d'affichage + intitulé de chaque groupe.
const SECTIONS = [
  { tier: "player", title: "🎮 Tout le monde" },
  { tier: "host", title: "🎯 Hôte de la partie & responsables" },
  { tier: "owner", title: "👑 Propriétaires du bot" },
];

module.exports = {
  name: "aide",
  aliases: ["help", "commandes"],
  description: "Affiche la liste des commandes",
  usage: "aide",
  tier: "player",

  async execute(message) {
    const prefix = settings.get("prefix");
    const isOwner = access.canOpenPanel(message.author.id);

    const commands = [...message.client.commands.values()]
      // Les alias pointent sur le même module : une seule entrée par commande.
      .filter((command, index, all) => all.findIndex((c) => c.name === command.name) === index);

    const blocks = [];
    for (const section of SECTIONS) {
      // La section « propriétaires » reste invisible pour les autres.
      if (section.tier === "owner" && !isOwner) continue;

      const inSection = commands.filter((command) => (command.tier || "player") === section.tier);
      if (!inSection.length) continue;

      const lines = inSection.map((command) => {
        const aliases = command.aliases?.length ? `  ·  alias : ${command.aliases.map((a) => `\`${prefix}${a}\``).join(" ")}` : "";
        return `\`${prefix}${command.usage || command.name}\`\n-# ${command.description}${aliases}`;
      });
      blocks.push(`**${section.title}**\n${lines.join("\n")}`);
    }

    const restricted = settings.get("restrictCreation") && !access.isManager(message.author.id)
      ? `-# 🔒 La création de parties est actuellement réservée : \`${prefix}custom\` t'est refusé.`
      : null;

    // `null` = ligne à retirer ; `""` = ligne vide volontaire (espacement).
    const body = [
      `Préfixe : \`${prefix}\`  ·  Ton rang : **${access.tierLabel(message.author.id)}**`,
      "",
      blocks.join("\n\n"),
      "",
      "-# Le reste se pilote aux boutons, directement sur le panneau de la partie :",
      "-# rejoindre une équipe, liste d'attente, quitter, lancer et terminer.",
      restricted,
    ].filter((line) => line !== null);

    return message.channel.send(buildSimplePanel({
      title: "Commandes — Customs Valorant",
      body: body.join("\n"),
    }));
  },
};
