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

function buildMemberSelectPanel(title, selectId, instruction) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${instruction}`));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId(selectId).setPlaceholder("Choisir un membre").setMinValues(1).setMaxValues(1)
    )
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

// Reprend le style d'un panel de référence fourni par l'utilisateur : titre,
// champ "Cible" (mention + tag du membre déjà choisi), instruction, puis un
// menu déroulant de rôles.
function buildTargetedRoleSelectPanel(title, targetId, targetTag, selectId, instruction) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${title}\n**Cible :** <@${targetId}> (\`${targetTag}\`)\n${instruction}`)
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId(selectId).setPlaceholder("Choisir un rôle").setMinValues(1).setMaxValues(1)
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
 * Applique l'ajout/retrait du rôle choisi dans une interaction RoleSelectMenu,
 * commun aux deux points d'entrée : le panel complet en 2 étapes (membre puis
 * rôle) et `.addrole`/`.delrole @membre` (membre déjà connu, saute direct à
 * l'étape rôle) — voir plus bas.
 * @param {import('discord.js').RoleSelectMenuInteraction} i
 * @param {import('discord.js').Message} message
 * @param {string} targetId
 * @param {"add"|"remove"} action
 */
async function applyRoleChange(i, message, targetId, action) {
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
    return;
  }

  const hasRole = member.roles.cache.has(role.id);
  if (action === "add" && hasRole) {
    await i.editReply(buildStatusPanel(`**${member.user.tag}** a déjà le rôle **${role.name}**.`));
    return;
  }
  if (action === "remove" && !hasRole) {
    await i.editReply(buildStatusPanel(`**${member.user.tag}** n'a pas le rôle **${role.name}**.`));
    return;
  }

  const commandName = action === "add" ? ".addrole" : ".delrole";
  const ok = await member.roles[action](
    role,
    `${action === "add" ? "Ajouté" : "Retiré"} via ${commandName} par ${message.author.tag}`
  )
    .then(() => true)
    .catch((err) => {
      console.error(err);
      return false;
    });

  if (!ok) {
    await i.editReply(
      buildStatusPanel(
        `Impossible de ${action === "add" ? "ajouter" : "retirer"} **${role.name}** ${
          action === "add" ? "à" : "de"
        } **${member.user.tag}** (erreur Discord).`
      )
    );
    return;
  }

  const verbPast = action === "add" ? "ajouté" : "retiré";
  const prep = action === "add" ? "à" : "de";
  sendLog(i.client, i.guild.id, "roles", {
    title: action === "add" ? "Ajout de rôle" : "Retrait de rôle",
    description: `Rôle **${role.name}** ${verbPast} ${prep} <@${member.id}>.`,
    actor: message.author,
  });
  await i.editReply(buildStatusPanel(`Rôle **${role.name}** ${verbPast} ${prep} **${member.user.tag}**.`));
}

const ADD_USER_SELECT = "addrole_user_select";
const ADD_ROLE_SELECT = "addrole_role_select";
const DEL_USER_SELECT = "delrole_user_select";
const DEL_ROLE_SELECT = "delrole_role_select";

/**
 * `.addrole` (sans argument) : panel en deux étapes (choisir le membre, puis
 * le rôle à lui ajouter) — aucun composant Discord ne permet de combiner les
 * deux choix dans un seul menu déroulant, donc le customId du menu de rôle
 * embarque l'id du membre choisi à l'étape précédente.
 * @param {import('discord.js').Message} message
 */
async function handleAddRolePanel(message) {
  const panelMessage = await message.reply(
    buildMemberSelectPanel("Ajout de rôle", ADD_USER_SELECT, "Sélectionnez le membre.")
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
        const target = i.users.first();
        await i.update(
          buildTargetedRoleSelectPanel(
            "Ajout de rôle",
            target.id,
            target.tag,
            `${ADD_ROLE_SELECT}:${target.id}`,
            "Sélectionnez le rôle à ajouter."
          )
        );
        return;
      }

      if (i.isRoleSelectMenu() && i.customId.startsWith(`${ADD_ROLE_SELECT}:`)) {
        const targetId = i.customId.split(":")[1];
        await applyRoleChange(i, message, targetId, "add");
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
 * `.delrole` (sans argument) : même flux en deux étapes que `.addrole`, mais
 * retire le rôle choisi au lieu de l'ajouter.
 * @param {import('discord.js').Message} message
 */
async function handleDelRolePanel(message) {
  const panelMessage = await message.reply(
    buildMemberSelectPanel("Retrait de rôle", DEL_USER_SELECT, "Sélectionnez le membre.")
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
        const target = i.users.first();
        await i.update(
          buildTargetedRoleSelectPanel(
            "Retrait de rôle",
            target.id,
            target.tag,
            `${DEL_ROLE_SELECT}:${target.id}`,
            "Sélectionnez le rôle à retirer."
          )
        );
        return;
      }

      if (i.isRoleSelectMenu() && i.customId.startsWith(`${DEL_ROLE_SELECT}:`)) {
        const targetId = i.customId.split(":")[1];
        await applyRoleChange(i, message, targetId, "remove");
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

/**
 * `.addrole @membre` / `.addrole <id>` : le membre est déjà connu, donc on
 * saute directement à l'étape "choisir le rôle" (même style que le panel
 * complet, avec un champ "Cible" affichant qui a déjà été choisi).
 * @param {import('discord.js').Message} message
 * @param {string} memberArg
 */
async function handleAddRoleForMember(message, memberArg) {
  const member = await resolveMemberArg(message.guild, memberArg);
  if (!member) {
    await message.reply({ embeds: [buildStatusEmbed("error", "Membre introuvable (mention ou ID invalide).")] });
    return;
  }

  const panelMessage = await message.reply(
    buildTargetedRoleSelectPanel(
      "Ajout de rôle",
      member.id,
      member.user.tag,
      `${ADD_ROLE_SELECT}:${member.id}`,
      "Sélectionnez le rôle à ajouter."
    )
  );
  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS, max: 1 });

  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== message.author.id) {
        await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
        return;
      }
      await applyRoleChange(i, message, member.id, "add");
    } catch (err) {
      console.error("[rolePanels] Erreur dans le panel .addrole :", err);
      await safeErrorReply(i);
    }
  });

  collector.on("end", (collected) => {
    if (collected.size === 0) panelMessage.edit({ components: [] }).catch(() => {});
  });
}

/**
 * `.delrole @membre` / `.delrole <id>` : équivalent de handleAddRoleForMember
 * pour le retrait.
 * @param {import('discord.js').Message} message
 * @param {string} memberArg
 */
async function handleDelRoleForMember(message, memberArg) {
  const member = await resolveMemberArg(message.guild, memberArg);
  if (!member) {
    await message.reply({ embeds: [buildStatusEmbed("error", "Membre introuvable (mention ou ID invalide).")] });
    return;
  }

  const panelMessage = await message.reply(
    buildTargetedRoleSelectPanel(
      "Retrait de rôle",
      member.id,
      member.user.tag,
      `${DEL_ROLE_SELECT}:${member.id}`,
      "Sélectionnez le rôle à retirer."
    )
  );
  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS, max: 1 });

  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== message.author.id) {
        await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
        return;
      }
      await applyRoleChange(i, message, member.id, "remove");
    } catch (err) {
      console.error("[rolePanels] Erreur dans le panel .delrole :", err);
      await safeErrorReply(i);
    }
  });

  collector.on("end", (collected) => {
    if (collected.size === 0) panelMessage.edit({ components: [] }).catch(() => {});
  });
}

/**
 * `.addrole @membre @role` / `.addrole <id membre> <id rôle>` — équivalent
 * direct, sans aucun panel, pour qui connaît déjà la mention/l'ID des deux.
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
          "Utilisation : `.addrole @membre @role` (ou leurs ID), `.addrole @membre` pour choisir le rôle via menu, ou `.addrole` seul pour tout choisir via menus."
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
          "Utilisation : `.delrole @membre @role` (ou leurs ID), `.delrole @membre` pour choisir le rôle via menu, ou `.delrole` seul pour tout choisir via menus."
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

module.exports = {
  handleAddRolePanel,
  handleDelRolePanel,
  handleAddRoleForMember,
  handleDelRoleForMember,
  addRoleDirect,
  delRoleDirect,
};
