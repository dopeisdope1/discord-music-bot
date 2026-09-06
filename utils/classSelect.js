const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");
const classRolesStore = require("./classRolesStore");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");

const ID = "class";
// Encodé dans le customId du bouton Submit tant qu'aucune classe n'a encore
// été choisie dans CE panneau — permet de garder le bouton désactivé sans
// avoir besoin d'un état en mémoire (voir buildPanel : tout part du message
// lui-même, donc un redémarrage du bot entre deux étapes ne casse rien).
const NONE = "_";
// Limite Discord : 25 options max par menu déroulant.
const MAX_OPTIONS = 25;

function eligibleRoles(guild) {
  const ids = classRolesStore.getRoleIds(guild.id);
  return ids.map((id) => guild.roles.cache.get(id)).filter(Boolean).slice(0, MAX_OPTIONS);
}

function currentClassRole(member, roles) {
  return roles.find((r) => member.roles.cache.has(r.id)) || null;
}

/**
 * Construit le panneau de sélection de classe, à tous ses états.
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildMember} member qui ouvre/pilote le panneau
 * @param {string} authorId encodé dans chaque customId : lui seul peut piloter ce panneau
 * @param {string|null} [highlightRoleId] classe en surbrillance avant validation (sinon la classe actuelle du membre, si elle est éligible)
 * @param {"open"|"confirmed"|"cancelled"} [state]
 */
function buildClassPanel(guild, member, authorId, highlightRoleId = null, state = "open") {
  const roles = eligibleRoles(guild);
  const container = new ContainerBuilder();

  if (!roles.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "## Sélection de classe\nAucune classe n'est configurée sur ce serveur. Un admin peut en ajouter avec `classes add @rôle`."
      )
    );
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

  const highlighted = highlightRoleId || currentClassRole(member, roles)?.id || null;

  if (state === "cancelled") {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## Sélection de classe\nAnnulé — ta classe n'a pas changé.")
    );
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

  if (state === "confirmed") {
    const role = roles.find((r) => r.id === highlighted);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## Sélection de classe\n✅ Classe confirmée : **${role?.name || "?"}**`)
    );
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      ["## Sélection de classe", "Choisis ta classe *", "Ta classe détermine le rôle qui te sera attribué."].join("\n")
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  const options = roles.map((role) => {
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(role.name)
      .setValue(role.id)
      .setDefault(role.id === highlighted);
    // Icône de rôle native (unicode) si le serveur en a une — jamais inventée.
    if (role.unicodeEmoji) option.setEmoji(role.unicodeEmoji);
    return option;
  });

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`${ID}:select:${authorId}`).setPlaceholder("Choisir une classe").addOptions(options)
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${ID}:cancel:${authorId}`).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${ID}:submit:${authorId}:${highlighted || NONE}`)
        .setLabel("Submit")
        .setStyle(ButtonStyle.Success)
        .setDisabled(!highlighted)
    )
  );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** &class — ouvert à tout le monde, chacun ne pilote que SON propre panneau. */
async function openClassSelect(client, message) {
  return message.reply(buildClassPanel(message.guild, message.member, message.author.id));
}

/**
 * Toutes les interactions "class:select|submit|cancel:<authorId>[:roleId]"
 * (voir index.js). Message public, réservé à qui a lancé &class — même
 * principe que utils/helpPanel.js.
 */
async function handleClassInteraction(interaction) {
  const [, action, authorId, roleIdFromButton] = interaction.customId.split(":");
  if (interaction.user.id !== authorId) {
    return interaction.reply({ content: "Ce menu ne t'appartient pas.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  const guild = interaction.guild;
  const member = interaction.member;
  if (!guild || !member) {
    return interaction.reply({ content: "Cette action doit se faire sur un serveur.", flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  if (action === "cancel") {
    return interaction.update(buildClassPanel(guild, member, authorId, null, "cancelled")).catch((err) => console.error("[classSelect]", err));
  }

  const eligibleIds = classRolesStore.getRoleIds(guild.id);

  if (action === "select") {
    const roleId = interaction.values[0];
    if (!guild.roles.cache.has(roleId) || !eligibleIds.includes(roleId)) {
      return interaction
        .reply({ content: "Cette classe n'est plus disponible, relance `&class`.", flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
    return interaction.update(buildClassPanel(guild, member, authorId, roleId)).catch((err) => console.error("[classSelect]", err));
  }

  if (action === "submit") {
    if (!roleIdFromButton || roleIdFromButton === NONE) {
      return interaction.reply({ content: "Choisis une classe avant de valider.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    const role = guild.roles.cache.get(roleIdFromButton);
    if (!role || !eligibleIds.includes(roleIdFromButton)) {
      return interaction.reply({ content: "Cette classe n'existe plus, relance `&class`.", flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    if (member.roles.cache.has(role.id)) {
      return interaction.update(buildClassPanel(guild, member, authorId, role.id, "confirmed")).catch((err) => console.error("[classSelect]", err));
    }

    const othersHeld = eligibleIds.filter((id) => id !== role.id && member.roles.cache.has(id));
    try {
      if (othersHeld.length) await member.roles.remove(othersHeld, "Changement de classe");
      await member.roles.add(role, "Sélection de classe");
    } catch (err) {
      return interaction.reply({ content: `Discord a refusé : ${err.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    return interaction.update(buildClassPanel(guild, member, authorId, role.id, "confirmed")).catch((err) => console.error("[classSelect]", err));
  }
}

function parseRoleArg(message, args) {
  return message.mentions.roles?.first() || (args[0] ? message.guild.roles.cache.get(args[0]) : null);
}

/** &classes add @rôle — whiteliste un rôle déjà existant comme classe sélectionnable. */
async function classesAdd(client, message, args) {
  if (!can(message.member, "server.classes.manage")) return;
  const role = parseRoleArg(message, args);
  if (!role) return message.reply({ embeds: [buildStatusEmbed("error", "Indique un rôle : `classes add @rôle`.")] });
  if (role.id === message.guild.id) return message.reply({ embeds: [buildStatusEmbed("error", "@everyone ne peut pas être une classe.")] });
  if (!classRolesStore.addRole(message.guild.id, role.id)) {
    return message.reply({ embeds: [buildStatusEmbed("info", `**${role.name}** est déjà une classe sélectionnable.`)] });
  }
  return message.reply({ embeds: [buildStatusEmbed("success", `**${role.name}** ajouté comme classe sélectionnable (voir \`&class\`).`)] });
}

/** &classes del @rôle — retire un rôle de la liste des classes sélectionnables. */
async function classesDel(client, message, args) {
  if (!can(message.member, "server.classes.manage")) return;
  const role = parseRoleArg(message, args);
  if (!role) return message.reply({ embeds: [buildStatusEmbed("error", "Indique un rôle : `classes del @rôle`.")] });
  if (!classRolesStore.removeRole(message.guild.id, role.id)) {
    return message.reply({ embeds: [buildStatusEmbed("info", `**${role.name}** n'était pas une classe sélectionnable.`)] });
  }
  return message.reply({ embeds: [buildStatusEmbed("success", `**${role.name}** retiré des classes sélectionnables.`)] });
}

/** &classes list — liste les rôles actuellement configurés comme classes. */
async function classesList(client, message) {
  if (!can(message.member, "server.classes.manage")) return;
  const roles = classRolesStore.getRoleIds(message.guild.id).map((id) => message.guild.roles.cache.get(id)).filter(Boolean);
  if (!roles.length) {
    return message.reply({ embeds: [buildStatusEmbed("info", "Aucune classe configurée. Ajoute-en avec `classes add @rôle`.")] });
  }
  return message.reply({ embeds: [buildStatusEmbed("info", roles.map((r) => `• ${r}`).join("\n"), { title: "Classes sélectionnables" })] });
}

module.exports = { buildClassPanel, openClassSelect, handleClassInteraction, classesAdd, classesDel, classesList };
