const {
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  MessageFlags,
} = require("discord.js");
const { validateMassRoleTarget } = require("./massRole");
const { sendLog } = require("./actionLogger");
const { buildStatusEmbed } = require("./statusEmbed");

const PANEL_TIMEOUT_MS = 60_000;

function buildStatusPanel(text) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildUserSelectPanel(headerText, selectId) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId(selectId).setPlaceholder("👤 Choisir un membre").setMinValues(1).setMaxValues(1)
    )
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildRoleSelectPanel(headerText, selectId, placeholder) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(headerText));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId(selectId).setPlaceholder(placeholder).setMinValues(1).setMaxValues(1)
    )
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

// Filet de sécurité : sans ça, une exception dans un handler de collector part
// en promesse non gérée (voir utils/banPanel.js pour le même motif).
async function safeErrorReply(i) {
  try {
    if (i.deferred || i.replied) {
      await i.editReply(buildStatusPanel("Une erreur est survenue, réessaie."));
    } else {
      await i.reply({ content: "Une erreur est survenue, réessaie.", ephemeral: true });
    }
  } catch {
    /* rien de plus possible côté Discord */
  }
}

const ADD_USER_SELECT = "addrole_user_select";
const ADD_ROLE_SELECT = "addrole_role_select";
const DEL_USER_SELECT = "delrole_user_select";
const DEL_ROLE_SELECT = "delrole_role_select";

/**
 * `.addrole` : panel en deux étapes (choisir le membre, puis le rôle à lui
 * ajouter) — aucun composant Discord ne permet de combiner les deux choix
 * dans un seul menu déroulant, donc le customId du menu de rôle embarque
 * l'id du membre choisi à l'étape précédente.
 * @param {import('discord.js').Message} message
 */
async function handleAddRolePanel(message) {
  const panelMessage = await message.reply(
    buildUserSelectPanel("## Ajouter un rôle à un membre\n> Choisis le membre.", ADD_USER_SELECT)
  );
  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });
  let done = false;

  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== message.author.id) {
        await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
        return;
      }

      if (i.isUserSelectMenu() && i.customId === ADD_USER_SELECT) {
        const targetId = i.values[0];
        await i.update(
          buildRoleSelectPanel(
            `## Ajouter un rôle à <@${targetId}>\n> Choisis le rôle.`,
            `${ADD_ROLE_SELECT}:${targetId}`,
            "Ajouter ce rôle à ce membre"
          )
        );
        return;
      }

      if (i.isRoleSelectMenu() && i.customId.startsWith(`${ADD_ROLE_SELECT}:`)) {
        const targetId = i.customId.split(":")[1];
        const role = i.roles.first();
        const invalidReason = validateMassRoleTarget(i.guild, role);
        if (invalidReason) {
          await i.reply({ content: invalidReason, ephemeral: true });
          return;
        }

        await i.deferUpdate();
        const member = await i.guild.members.fetch(targetId).catch(() => null);
        if (!member) {
          await i.editReply(buildStatusPanel("Ce membre n'est plus sur le serveur."));
          done = true;
          collector.stop();
          return;
        }
        if (member.roles.cache.has(role.id)) {
          await i.editReply(buildStatusPanel(`**${member.user.tag}** a déjà le rôle **${role.name}**.`));
          done = true;
          collector.stop();
          return;
        }

        const added = await member.roles
          .add(role, `Ajouté via .addrole par ${message.author.tag}`)
          .then(() => true)
          .catch((err) => {
            console.error(err);
            return false;
          });

        if (!added) {
          await i.editReply(buildStatusPanel(`Impossible d'ajouter **${role.name}** à **${member.user.tag}** (erreur Discord).`));
          done = true;
          collector.stop();
          return;
        }

        sendLog(i.client, i.guild.id, "roles", {
          title: "Ajout de rôle",
          description: `Rôle **${role.name}** ajouté à <@${member.id}>.`,
          actor: message.author,
        });
        await i.editReply(buildStatusPanel(`Rôle **${role.name}** ajouté à **${member.user.tag}**.`));
        done = true;
        collector.stop();
      }
    } catch (err) {
      console.error("[rolePanels] Erreur dans le panel .addrole :", err);
      await safeErrorReply(i);
    }
  });

  collector.on("end", () => {
    if (!done) panelMessage.edit({ components: [] }).catch(() => {});
  });
}

/**
 * `.delrole` : même flux en deux étapes que `.addrole`, mais retire le rôle
 * choisi au lieu de l'ajouter.
 * @param {import('discord.js').Message} message
 */
async function handleDelRolePanel(message) {
  const panelMessage = await message.reply(
    buildUserSelectPanel("## Retirer un rôle à un membre\n> Choisis le membre.", DEL_USER_SELECT)
  );
  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });
  let done = false;

  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== message.author.id) {
        await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
        return;
      }

      if (i.isUserSelectMenu() && i.customId === DEL_USER_SELECT) {
        const targetId = i.values[0];
        await i.update(
          buildRoleSelectPanel(
            `## Retirer un rôle à <@${targetId}>\n> Choisis le rôle.`,
            `${DEL_ROLE_SELECT}:${targetId}`,
            "Retirer ce rôle à ce membre"
          )
        );
        return;
      }

      if (i.isRoleSelectMenu() && i.customId.startsWith(`${DEL_ROLE_SELECT}:`)) {
        const targetId = i.customId.split(":")[1];
        const role = i.roles.first();
        const invalidReason = validateMassRoleTarget(i.guild, role);
        if (invalidReason) {
          await i.reply({ content: invalidReason, ephemeral: true });
          return;
        }

        await i.deferUpdate();
        const member = await i.guild.members.fetch(targetId).catch(() => null);
        if (!member) {
          await i.editReply(buildStatusPanel("Ce membre n'est plus sur le serveur."));
          done = true;
          collector.stop();
          return;
        }
        if (!member.roles.cache.has(role.id)) {
          await i.editReply(buildStatusPanel(`**${member.user.tag}** n'a pas le rôle **${role.name}**.`));
          done = true;
          collector.stop();
          return;
        }

        const removed = await member.roles
          .remove(role, `Retiré via .delrole par ${message.author.tag}`)
          .then(() => true)
          .catch((err) => {
            console.error(err);
            return false;
          });

        if (!removed) {
          await i.editReply(buildStatusPanel(`Impossible de retirer **${role.name}** à **${member.user.tag}** (erreur Discord).`));
          done = true;
          collector.stop();
          return;
        }

        sendLog(i.client, i.guild.id, "roles", {
          title: "Retrait de rôle",
          description: `Rôle **${role.name}** retiré de <@${member.id}>.`,
          actor: message.author,
        });
        await i.editReply(buildStatusPanel(`Rôle **${role.name}** retiré de **${member.user.tag}**.`));
        done = true;
        collector.stop();
      }
    } catch (err) {
      console.error("[rolePanels] Erreur dans le panel .delrole :", err);
      await safeErrorReply(i);
    }
  });

  collector.on("end", () => {
    if (!done) panelMessage.edit({ components: [] }).catch(() => {});
  });
}

async function resolveMemberArg(guild, raw) {
  if (!raw) return null;
  const id = raw.replace(/[<@!>]/g, "");
  if (!/^\d{15,}$/.test(id)) return null;
  return guild.members.fetch(id).catch(() => null);
}

async function resolveRoleArg(guild, raw) {
  if (!raw) return null;
  const id = raw.replace(/[<@&>]/g, "");
  if (!/^\d{15,}$/.test(id)) return null;
  return guild.roles.fetch(id).catch(() => null);
}

/**
 * `.addrole @membre @role` / `.addrole <id membre> <id rôle>` — équivalent
 * direct de handleAddRolePanel, pour qui connaît déjà la mention/l'ID des
 * deux et veut éviter les menus déroulants.
 * @param {import('discord.js').Message} message
 * @param {string} memberArg
 * @param {string} roleArg
 */
async function addRoleDirect(message, memberArg, roleArg) {
  const member = await resolveMemberArg(message.guild, memberArg);
  const role = await resolveRoleArg(message.guild, roleArg);
  if (!member || !role) {
    return message.reply({
      embeds: [
        buildStatusEmbed(
          "error",
          "Utilisation : `.addrole @membre @role` (ou leurs ID), ou `.addrole` seul pour les menus déroulants."
        ),
      ],
    });
  }

  const invalidReason = validateMassRoleTarget(message.guild, role);
  if (invalidReason) {
    return message.reply({ embeds: [buildStatusEmbed("error", invalidReason)] });
  }
  if (member.roles.cache.has(role.id)) {
    return message.reply({
      embeds: [buildStatusEmbed("info", `**${member.user.tag}** a déjà le rôle **${role.name}**.`)],
    });
  }

  const added = await member.roles
    .add(role, `Ajouté via .addrole par ${message.author.tag}`)
    .then(() => true)
    .catch((err) => {
      console.error(err);
      return false;
    });

  if (!added) {
    return message.reply({
      embeds: [buildStatusEmbed("error", `Impossible d'ajouter **${role.name}** à **${member.user.tag}** (erreur Discord).`)],
    });
  }

  sendLog(message.client, message.guild.id, "roles", {
    title: "Ajout de rôle",
    description: `Rôle **${role.name}** ajouté à <@${member.id}>.`,
    actor: message.author,
  });
  await message.reply({ embeds: [buildStatusEmbed("success", `Rôle **${role.name}** ajouté à **${member.user.tag}**.`)] });
}

/**
 * `.delrole @membre @role` / `.delrole <id membre> <id rôle>` — équivalent
 * direct de handleDelRolePanel.
 * @param {import('discord.js').Message} message
 * @param {string} memberArg
 * @param {string} roleArg
 */
async function delRoleDirect(message, memberArg, roleArg) {
  const member = await resolveMemberArg(message.guild, memberArg);
  const role = await resolveRoleArg(message.guild, roleArg);
  if (!member || !role) {
    return message.reply({
      embeds: [
        buildStatusEmbed(
          "error",
          "Utilisation : `.delrole @membre @role` (ou leurs ID), ou `.delrole` seul pour les menus déroulants."
        ),
      ],
    });
  }

  const invalidReason = validateMassRoleTarget(message.guild, role);
  if (invalidReason) {
    return message.reply({ embeds: [buildStatusEmbed("error", invalidReason)] });
  }
  if (!member.roles.cache.has(role.id)) {
    return message.reply({
      embeds: [buildStatusEmbed("info", `**${member.user.tag}** n'a pas le rôle **${role.name}**.`)],
    });
  }

  const removed = await member.roles
    .remove(role, `Retiré via .delrole par ${message.author.tag}`)
    .then(() => true)
    .catch((err) => {
      console.error(err);
      return false;
    });

  if (!removed) {
    return message.reply({
      embeds: [buildStatusEmbed("error", `Impossible de retirer **${role.name}** à **${member.user.tag}** (erreur Discord).`)],
    });
  }

  sendLog(message.client, message.guild.id, "roles", {
    title: "Retrait de rôle",
    description: `Rôle **${role.name}** retiré de <@${member.id}>.`,
    actor: message.author,
  });
  await message.reply({ embeds: [buildStatusEmbed("success", `Rôle **${role.name}** retiré de **${member.user.tag}**.`)] });
}

module.exports = { handleAddRolePanel, handleDelRolePanel, addRoleDirect, delRoleDirect };
