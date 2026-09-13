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
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  PermissionFlagsBits,
} = require("discord.js");
const { getPrefixes } = require("./prefixStore");
const selfClearStore = require("./selfClearStore");
const { can } = require("./permissions/engine");
const { parseDuration, formatDuration } = require("./moderationCommands");

// "!!setclear" — configure les noms qui déclenchent le nettoyage automatique
// ("<nom> clear", voir utils/selfClear.js) et le délai entre deux usages,
// PAR SERVEUR (voir utils/selfClearStore.js). Même préfixe "!!" que
// !!panel/!!confess, un mot différent après ("setclear").
//
// Qui a le droit de configurer : la permission dédiée du catalogue EXISTANT
// (&panel > Permissions) "server.selfclear.manage", ou un administrateur
// Discord — jamais un rôle codé en dur (même principe que !!confess).
const CUSTOM_ID = "setclear";
const PERM = "server.selfclear.manage";

// Brouillon en cours d'édition, EN MÉMOIRE par (serveur, personne) — comme
// utils/confessions.js::enCours. Rien à faire survivre à un redémarrage :
// une édition interrompue force juste à retaper "!!setclear". Le brouillon
// n'est écrit dans utils/selfClearStore.js qu'au clic sur "Confirmer".
// "guildId:userId" -> { names: string[], cooldownMs: number }
const brouillons = new Map();

const cleBrouillon = (guildId, userId) => `${guildId}:${userId}`;

function estAutorise(member) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator) || can(member, PERM));
}

function buildSetClearCard(brouillon) {
  const nomsTexte = brouillon.names.length
    ? brouillon.names.map((n, i) => `${i + 1}. \`${n}\``).join("\n")
    : "*Aucun nom configuré — le déclencheur est désactivé.*";

  const conteneur = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("## Configuration"))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("Configure ici les paramètres du nettoyage automatique (`<nom> clear`)."))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Noms autorisés**\n${nomsTexte}`))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`**Temps entre chaque clear**\n${formatDuration(brouillon.cooldownMs)}`))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent("Sélectionne le paramètre que tu veux modifier."))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${CUSTOM_ID}:choix`)
          .setPlaceholder("Que veux-tu configurer ?")
          .addOptions(
            new StringSelectMenuOptionBuilder().setLabel("Noms autorisés").setValue("noms"),
            new StringSelectMenuOptionBuilder().setLabel("Temps entre chaque clear").setValue("cooldown")
          )
      )
    )
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${CUSTOM_ID}:confirmer`).setLabel("Confirmer").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${CUSTOM_ID}:reinitialiser`).setLabel("Réinitialiser").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${CUSTOM_ID}:annuler`).setLabel("Annuler").setStyle(ButtonStyle.Danger)
      )
    );

  return { flags: MessageFlags.IsComponentsV2, components: [conteneur] };
}

/** "!!setclear" — poste le panneau de configuration, la seule commande texte de ce fichier. */
async function handleSetClearTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const { protection: PREFIX } = getPrefixes(message.guild.id);
  const aLePrefixe = Boolean(PREFIX) && content.startsWith(PREFIX);
  const mot = aLePrefixe ? content.slice(PREFIX.length).trim().split(/\s+/)[0] : "";
  if (!aLePrefixe || (mot || "").toLowerCase() !== "setclear") return;

  if (!estAutorise(message.member)) {
    return message.reply("Tu n'as pas la permission nécessaire pour configurer ça.").catch(() => {});
  }

  const config = selfClearStore.getConfig(message.guild.id);
  brouillons.set(cleBrouillon(message.guild.id, message.author.id), { names: [...config.names], cooldownMs: config.cooldownMs });
  return message.channel.send(buildSetClearCard(config)).catch(() => {});
}

async function handleSetClearInteraction(interaction) {
  const [, action] = interaction.customId.split(":");
  const guildId = interaction.guild.id;
  const cle = cleBrouillon(guildId, interaction.user.id);

  if (!estAutorise(interaction.member)) {
    return interaction.reply({ content: "❌ Tu n'as pas la permission de configurer ça.", flags: MessageFlags.Ephemeral });
  }

  if (action === "choix") {
    const brouillon = brouillons.get(cle) || selfClearStore.getConfig(guildId);
    const champ = interaction.values[0];

    if (champ === "noms") {
      const modal = new ModalBuilder().setCustomId(`${CUSTOM_ID}:noms`).setTitle("Noms autorisés");
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId("valeur")
            .setLabel("Noms séparés par des virgules")
            .setStyle(TextInputStyle.Paragraph)
            .setValue(brouillon.names.join(", "))
            .setRequired(true)
        )
      );
      return interaction.showModal(modal);
    }

    // champ === "cooldown"
    const modal = new ModalBuilder().setCustomId(`${CUSTOM_ID}:cooldown`).setTitle("Temps entre chaque clear");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("valeur")
          .setLabel("Durée (ex : 30s, 15m, 1h, 1d)")
          .setStyle(TextInputStyle.Short)
          .setValue(formatDuration(brouillon.cooldownMs))
          .setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "noms" || action === "cooldown") {
    const brouillon = brouillons.get(cle) || selfClearStore.getConfig(guildId);
    const valeur = interaction.fields.getTextInputValue("valeur").trim();

    if (action === "noms") {
      const names = valeur
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean);
      if (!names.length) {
        return interaction.reply({ content: "Indique au moins un nom.", flags: MessageFlags.Ephemeral });
      }
      brouillon.names = names;
    } else {
      const ms = parseDuration(valeur);
      if (!ms) {
        return interaction.reply({ content: "Durée invalide — exemple : `30s`, `15m`, `1h`, `1d`.", flags: MessageFlags.Ephemeral });
      }
      brouillon.cooldownMs = ms;
    }

    brouillons.set(cle, brouillon);
    return interaction.update(buildSetClearCard(brouillon));
  }

  if (action === "confirmer") {
    const brouillon = brouillons.get(cle) || selfClearStore.getConfig(guildId);
    selfClearStore.setNames(guildId, brouillon.names);
    selfClearStore.setCooldown(guildId, brouillon.cooldownMs);
    brouillons.delete(cle);
    return interaction.update(buildSetClearCard(brouillon));
  }

  if (action === "reinitialiser") {
    // Recharge ce qui est ENREGISTRÉ (annule les modifications non
    // confirmées) — pas les valeurs d'usine : "Annuler" ferme l'édition,
    // "Réinitialiser" revient juste au dernier état sauvegardé.
    const config = selfClearStore.getConfig(guildId);
    const brouillon = { names: [...config.names], cooldownMs: config.cooldownMs };
    brouillons.set(cle, brouillon);
    return interaction.update(buildSetClearCard(brouillon));
  }

  if (action === "annuler") {
    brouillons.delete(cle);
    return interaction.update({
      flags: MessageFlags.IsComponentsV2,
      components: [new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent("*Configuration annulée.*"))],
    });
  }
}

module.exports = { handleSetClearTextCommand, handleSetClearInteraction, CUSTOM_ID };
