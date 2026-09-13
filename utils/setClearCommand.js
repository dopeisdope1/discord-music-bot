const {
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ContainerBuilder,
  PermissionFlagsBits,
} = require("discord.js");
const { getPrefixes } = require("./prefixStore");
const selfClearStore = require("./selfClearStore");
const { can } = require("./permissions/engine");
const { parseDuration, formatDuration } = require("./moderationCommands");

// "!!setclear" — configure les mots qui déclenchent le nettoyage automatique
// ("<mot> clear", voir utils/selfClear.js) et le délai entre deux usages,
// PAR SERVEUR (voir utils/selfClearStore.js).
//
// Volontairement UN SEUL aller-retour plutôt qu'un menu déroulant + une
// modale par champ + un bouton "Confirmer" séparé : ici "Modifier" ouvre
// directement une modale avec les deux réglages ensemble, la validation à la
// soumission écrit tout de suite dans le store — pas d'état "brouillon" en
// mémoire à gérer, pas d'étape de confirmation en trop.
//
// Qui a le droit de configurer : la permission dédiée du catalogue EXISTANT
// (&panel > Permissions) "server.selfclear.manage", ou un administrateur
// Discord — jamais un rôle codé en dur (même principe que !!confess).
const CUSTOM_ID = "setclear";
const PERM = "server.selfclear.manage";

function estAutorise(member) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator) || can(member, PERM));
}

function buildSetClearCard(config) {
  const declencheurs = config.names.length
    ? config.names.map((n) => `\`${n} clear\``).join(" · ")
    : "*aucun — le nettoyage automatique est désactivé*";

  const conteneur = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("## 🧹 Nettoyage automatique"))
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent("Tape un des mots ci-dessous suivi de `clear` pour supprimer tes propres messages du salon.")
    )
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Déclencheurs**\n${declencheurs}`))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Délai entre deux utilisations**\n${formatDuration(config.cooldownMs)}`))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${CUSTOM_ID}:modifier`).setLabel("Modifier").setStyle(ButtonStyle.Primary).setEmoji("✏️"),
        new ButtonBuilder().setCustomId(`${CUSTOM_ID}:reinitialiser`).setLabel("Valeurs par défaut").setStyle(ButtonStyle.Secondary).setEmoji("↺")
      )
    );

  return { flags: MessageFlags.IsComponentsV2, components: [conteneur] };
}

/** "!!setclear" — poste le panneau, la seule commande texte de ce fichier. */
async function handleSetClearTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const { protection: PREFIX } = getPrefixes(message.guild.id);
  const aLePrefixe = Boolean(PREFIX) && content.startsWith(PREFIX);
  const mot = aLePrefixe ? content.slice(PREFIX.length).trim().split(/\s+/)[0] : "";
  if (!aLePrefixe || (mot || "").toLowerCase() !== "setclear") return;

  if (!estAutorise(message.member)) {
    return message
      .reply("Tu n'as pas la permission nécessaire pour configurer ça.")
      .catch((err) => console.error("[setClearCommand] échec de la réponse (refus) :", err));
  }

  return message.channel
    .send(buildSetClearCard(selfClearStore.getConfig(message.guild.id)))
    .catch((err) => console.error("[setClearCommand] échec de l'envoi du panneau :", err));
}

async function handleSetClearInteraction(interaction) {
  const [, action] = interaction.customId.split(":");
  const guildId = interaction.guild.id;

  if (!estAutorise(interaction.member)) {
    return interaction.reply({ content: "❌ Tu n'as pas la permission de configurer ça.", flags: MessageFlags.Ephemeral });
  }

  if (action === "modifier") {
    const config = selfClearStore.getConfig(guildId);
    const modal = new ModalBuilder().setCustomId(`${CUSTOM_ID}:editer`).setTitle("Nettoyage automatique");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("noms")
          .setLabel("Déclencheurs, séparés par des virgules")
          .setStyle(TextInputStyle.Paragraph)
          .setValue(config.names.join(", "))
          .setRequired(true)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("cooldown")
          .setLabel("Délai entre deux usages (30s, 15m, 1h, 1d)")
          .setStyle(TextInputStyle.Short)
          .setValue(formatDuration(config.cooldownMs))
          .setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "editer") {
    const namesInput = interaction.fields.getTextInputValue("noms").trim();
    const cooldownInput = interaction.fields.getTextInputValue("cooldown").trim();

    const names = namesInput
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    if (!names.length) {
      return interaction.reply({ content: "Indique au moins un déclencheur.", flags: MessageFlags.Ephemeral });
    }
    const cooldownMs = parseDuration(cooldownInput);
    if (!cooldownMs) {
      return interaction.reply({ content: "Délai invalide — exemple : `30s`, `15m`, `1h`, `1d`.", flags: MessageFlags.Ephemeral });
    }

    selfClearStore.setNames(guildId, names);
    selfClearStore.setCooldown(guildId, cooldownMs);
    return interaction.update(buildSetClearCard(selfClearStore.getConfig(guildId)));
  }

  if (action === "reinitialiser") {
    selfClearStore.resetConfig(guildId);
    return interaction.update(buildSetClearCard(selfClearStore.getConfig(guildId)));
  }
}

module.exports = { handleSetClearTextCommand, handleSetClearInteraction, CUSTOM_ID };
