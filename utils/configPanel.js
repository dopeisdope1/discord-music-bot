const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");
const { getPrefixes, setPrefix } = require("./prefixStore");
const accessStore = require("./accessStore");

// Tous les identifiants d'interaction du panneau commencent par "cfg:", ce
// qui permet à index.js de les router sans les énumérer un par un.
const ID = "cfg";

// `ownerOnly` : rubrique réservée au propriétaire, invisible pour un sys.
// Le rang sys en fait partie — un sys qui pourrait en nommer d'autres rendrait
// l'accès irrévocable depuis l'intérieur.
const SECTIONS = [
  { key: "home", label: "Accueil", description: "Vue d'ensemble de la configuration" },
  { key: "prefixes", label: "Préfixes", description: "Préfixe musique et préfixe des commandes" },
  { key: "moderation", label: "Modération", description: "Qui échappe au quota et qui gère les salons" },
  { key: "sys", label: "Rang sys", description: "Qui a accès à tout le bot", ownerOnly: true },
  { key: "banall", label: "Ban de masse", description: "Qui peut lancer un ban de masse", ownerOnly: true },
];

const sectionsFor = (isOwner) => SECTIONS.filter((s) => isOwner || !s.ownerOnly);

// Rubrique à rouvrir après avoir modifié une portée : les portées "clear" et
// "salon" sont toutes deux gérées depuis Modération.
const SECTION_OF_SCOPE = { clear: "moderation", salon: "moderation", sys: "sys", banall: "banall" };

const mentions = (ids) => (ids.length ? ids.map((id) => `<@${id}>`).join(", ") : "*personne*");

function buildNav(current, isOwner) {
  return new StringSelectMenuBuilder()
    .setCustomId(`${ID}:nav`)
    .setPlaceholder("Choisis une rubrique à configurer")
    .addOptions(
      sectionsFor(isOwner).map((s) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(s.label)
          .setDescription(s.description)
          .setValue(s.key)
          .setDefault(s.key === current)
      )
    );
}

function sectionBody(section, guildId) {
  const prefixes = getPrefixes(guildId);
  const owners = accessStore.ownerIds();

  if (section === "prefixes") {
    return [
      `> **Préfixe musique** : \`${prefixes.main}\``,
      `> **Préfixe des commandes** : \`${prefixes.musicMod}\``,
      "",
      "Le préfixe des commandes est partagé avec les autres bots du serveur : " +
        "le bot ne répond qu'aux commandes qu'il connaît et ignore le reste.",
    ].join("\n");
  }

  if (section === "moderation") {
    return [
      `> **Dispensés du quota de nettoyage** : ${mentions(accessStore.list("clear"))}`,
      "Ces membres utilisent `uo clear` sans limite ; les autres sont plafonnés à 2 usages par 25 minutes.",
      "",
      `> **Accès aux commandes de salon** : ${mentions(accessStore.list("salon"))}`,
      "Ces membres peuvent utiliser `lock`, `unlock`, `hide`, `unhide` et `renew`.",
    ].join("\n");
  }

  if (section === "sys") {
    return [
      `> **Rang sys** : ${mentions(accessStore.list("sys"))}`,
      "",
      "Le rang sys donne accès à **tout le bot** : commandes de salon, dispenses, et ce panneau.",
      "Un sys ne peut pas en nommer d'autres — cette rubrique n'est visible que par toi.",
    ].join("\n");
  }

  if (section === "banall") {
    return [
      `> **Autorisés** : ${mentions(accessStore.list("banall"))}`,
      "",
      "Ces membres peuvent lancer `banall`, qui bannit tout le serveur d'un coup.",
      "Le propriétaire du serveur y a toujours droit, sans figurer ici.",
      "Le rang sys ne suffit **pas** : cet accès s'accorde un par un, et seulement par toi.",
    ].join("\n");
  }

  return [
    `> **Préfixe musique** : \`${prefixes.main}\``,
    `> **Préfixe des commandes** : \`${prefixes.musicMod}\``,
    `> **Propriétaire(s)** : ${mentions(owners)}`,
    `> **Rang sys** : ${mentions(accessStore.list("sys"))}`,
    `> **Dispensés du quota de nettoyage** : ${accessStore.list("clear").length}`,
    `> **Autorisés sur les commandes de salon** : ${accessStore.list("salon").length}`,
    "",
    "Sélectionne une rubrique ci-dessous pour la modifier.",
  ].join("\n");
}

/**
 * Menus d'ajout/retrait pour une portée. Le libellé précise à quoi sert la
 * portée : la rubrique Modération en affiche deux paires à la suite, sans
 * quoi on ne saurait plus quel menu agit sur quoi.
 */
function accessRows(scope, label) {
  return [
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId(`${ID}:add:${scope}`).setPlaceholder(`Ajouter — ${label}`)
    ),
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId(`${ID}:del:${scope}`).setPlaceholder(`Retirer — ${label}`)
    ),
  ];
}

/**
 * Panneau de configuration. Components V2 sans setAccentColor : pas de barre
 * de couleur sur le côté.
 */
function buildConfigPanel(guildId, current = "home", isOwner = false) {
  const available = sectionsFor(isOwner);
  const meta = available.find((s) => s.key === current) || available[0];
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Configuration\n### ${meta.label}`)
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(sectionBody(meta.key, guildId)));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(buildNav(meta.key, isOwner)));

  if (meta.key === "prefixes") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:prefix:main`).setLabel("Préfixe musique").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${ID}:prefix:musicMod`).setLabel("Préfixe commandes").setStyle(ButtonStyle.Secondary)
      )
    );
  } else if (meta.key === "moderation") {
    // Deux paires de menus (4 lignes) + la navigation = 5, soit le maximum
    // autorisé par Discord dans un message.
    for (const row of accessRows("clear", "dispense de nettoyage")) container.addActionRowComponents(row);
    for (const row of accessRows("salon", "accès aux salons")) container.addActionRowComponents(row);
  } else if (meta.key === "sys") {
    for (const row of accessRows("sys", "rang sys")) container.addActionRowComponents(row);
  } else if (meta.key === "banall") {
    for (const row of accessRows("banall", "ban de masse")) container.addActionRowComponents(row);
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

const PREFIX_FIELDS = {
  main: { label: "Préfixe musique", max: 5 },
  musicMod: { label: "Préfixe des commandes", max: 5 },
};

/**
 * Traite toutes les interactions du panneau (identifiants en "cfg:").
 * Le rang est re-vérifié à CHAQUE clic : le message du panneau reste visible
 * dans le salon après l'envoi, n'importe qui pourrait cliquer dessus.
 * La rubrique du rang sys n'est accessible qu'au propriétaire : un sys qui
 * pourrait en nommer d'autres rendrait l'accès irrévocable depuis l'intérieur.
 */
async function handleConfigInteraction(interaction) {
  const [, action, extra] = interaction.customId.split(":");

  if (!accessStore.isAllowed("sys", interaction.user.id)) {
    return interaction.reply({ content: "Tu n'as pas accès à ce panneau.", flags: MessageFlags.Ephemeral });
  }

  const guildId = interaction.guild.id;
  const isOwner = accessStore.isOwner(interaction.user.id);

  if (action === "nav") {
    return interaction.update(buildConfigPanel(guildId, interaction.values[0], isOwner));
  }

  if (action === "add" || action === "del") {
    // Garde-fou : le rang sys ne se distribue que par le propriétaire, même
    // si quelqu'un forgeait l'interaction sans passer par le menu.
    if (extra === "sys" && !isOwner) {
      return interaction.reply({
        content: "Seul le propriétaire du bot peut accorder le rang sys.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const userId = interaction.values[0];
    if (accessStore.isOwner(userId)) {
      return interaction.reply({
        content: `<@${userId}> est propriétaire du bot, il a déjà tous les accès.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    const changed = action === "add" ? accessStore.add(extra, userId) : accessStore.remove(extra, userId);
    if (!changed) {
      return interaction.reply({
        content: action === "add" ? `<@${userId}> y était déjà.` : `<@${userId}> n'y était pas.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    // Le panneau est réaffiché avec la liste à jour, sur la rubrique qui
    // contient cette portée — "clear" et "salon" vivent tous deux sous
    // Modération, leur nom n'est donc pas celui d'une rubrique.
    return interaction.update(buildConfigPanel(guildId, SECTION_OF_SCOPE[extra] || "home", isOwner));
  }

  if (action === "prefix") {
    if (interaction.isModalSubmit()) {
      const value = interaction.fields.getTextInputValue("value").trim();
      if (!value) {
        return interaction.reply({ content: "Préfixe vide, rien n'a été changé.", flags: MessageFlags.Ephemeral });
      }
      // Écrit dans DATA_DIR, monté sur un Volume Railway : la valeur survit
      // aux redéploiements sans qu'aucun salon Discord ne soit nécessaire.
      setPrefix(guildId, extra, value);
      await interaction.reply({
        content: `**${PREFIX_FIELDS[extra].label}** réglé sur \`${value}\`.`,
        flags: MessageFlags.Ephemeral,
      });
      // interaction.message existe quand la modale vient d'un bouton du panneau.
      return interaction.message?.edit(buildConfigPanel(guildId, "prefixes", isOwner)).catch(() => {});
    }

    const field = PREFIX_FIELDS[extra];
    const modal = new ModalBuilder().setCustomId(interaction.customId).setTitle(field.label);
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("value")
          .setLabel(field.label)
          .setStyle(TextInputStyle.Short)
          .setMaxLength(field.max)
          .setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }
}

module.exports = { buildConfigPanel, handleConfigInteraction, ID, SECTIONS };
