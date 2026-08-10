const {
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  MessageFlags,
} = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const {
  isEnabled,
  setEnabled,
  isOwner,
  isBotOwner,
  getOwners,
  addOwner,
  removeOwner,
  getWhitelist,
  addToWhitelist,
  removeFromWhitelist,
} = require("./antiNukeStore");
const { saveGuildConfig } = require("./configChannel");
const { sendLog } = require("./actionLogger");

const PANEL_TIMEOUT_MS = 10 * 60_000;

function resolveMemberArg(guild, raw) {
  if (!raw) return null;
  const id = raw.replace(/[<@!>]/g, "");
  return /^\d{15,}$/.test(id) ? id : null;
}

function buildAntifastPanel(guild) {
  const enabled = isEnabled(guild.id);
  const owners = getOwners(guild.id);
  const whitelist = getWhitelist(guild.id);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Anti-nuke ("antifast")\n> Statut : **${enabled ? "Activé ✅" : "Désactivé ❌"}**\n\n` +
        `**Owners** (en plus du propriétaire réel du serveur) : ${
          owners.length ? owners.map((id) => `<@${id}>`).join(", ") : "*aucun*"
        }\n` +
        `**Whitelist** : ${whitelist.length ? whitelist.map((id) => `<@${id}>`).join(", ") : "*aucune*"}`
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("antifast_toggle")
        .setLabel(enabled ? "❌ Désactiver" : "✅ Activer")
        .setStyle(enabled ? ButtonStyle.Danger : ButtonStyle.Success)
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId("antifast_owner_add")
        .setPlaceholder("➕ Ajouter un owner (propriétaire réel/du bot uniquement)")
        .setMinValues(1)
        .setMaxValues(1)
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId("antifast_owner_remove")
        .setPlaceholder("➖ Retirer un owner (propriétaire réel/du bot uniquement)")
        .setMinValues(1)
        .setMaxValues(1)
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId("antifast_wl_add")
        .setPlaceholder("➕ Ajouter à la whitelist")
        .setMinValues(1)
        .setMaxValues(1)
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId("antifast_wl_remove")
        .setPlaceholder("➖ Retirer de la whitelist")
        .setMinValues(1)
        .setMaxValues(1)
    )
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

async function safeErrorReply(i) {
  try {
    if (i.deferred || i.replied) {
      await i.followUp({ content: "Une erreur est survenue, réessaie.", ephemeral: true });
    } else {
      await i.reply({ content: "Une erreur est survenue, réessaie.", ephemeral: true });
    }
  } catch {
    /* rien de plus possible côté Discord */
  }
}

/**
 * Panel interactif `.antifast` (sans argument) : statut + bouton
 * activer/désactiver + menus pour gérer owners et whitelist, en plus des
 * commandes texte `.owner`/`.wl`. Toujours réservé aux owners anti-nuke pour
 * voir/interagir avec le panel ; ajouter/retirer un owner reste en plus
 * réservé au propriétaire réel du serveur ou du bot (mêmes règles que
 * `.owner`, vérifiées à nouveau ici — un owner délégué peut voir le panel
 * mais pas cliquer sur ces deux menus précis).
 * @param {import('discord.js').Message} message
 */
async function handleAntifastPanel(message) {
  const panelMessage = await message.reply(buildAntifastPanel(message.guild));
  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });

  collector.on("collect", async (i) => {
    try {
      if (!isOwner(i.guild, i.user.id)) {
        await i.reply({ content: "Réservé aux owners anti-nuke (voir `.owner`).", ephemeral: true });
        return;
      }

      if (i.isButton() && i.customId === "antifast_toggle") {
        const nowEnabled = !isEnabled(i.guild.id);
        setEnabled(i.guild.id, nowEnabled);
        await saveGuildConfig(i.guild);
        sendLog(i.client, i.guild.id, "securite", {
          title: nowEnabled ? "Anti-nuke activé" : "Anti-nuke désactivé",
          description: `Anti-nuke ${nowEnabled ? "activé" : "désactivé"} via le panel.`,
          actor: i.user,
        });
        await i.update(buildAntifastPanel(i.guild));
        return;
      }

      if (i.isUserSelectMenu() && (i.customId === "antifast_owner_add" || i.customId === "antifast_owner_remove")) {
        if (i.user.id !== i.guild.ownerId && !isBotOwner(i.user.id)) {
          await i.reply({ content: "Réservé au propriétaire du serveur (ou du bot).", ephemeral: true });
          return;
        }
        const targetId = i.values[0];
        const adding = i.customId === "antifast_owner_add";
        if (adding) addOwner(i.guild.id, targetId);
        else removeOwner(i.guild.id, targetId);
        await saveGuildConfig(i.guild);
        sendLog(i.client, i.guild.id, "securite", {
          title: adding ? "Owner anti-nuke ajouté" : "Owner anti-nuke retiré",
          description: `<@${targetId}> ${adding ? "ajouté aux" : "retiré des"} owners anti-nuke via le panel.`,
          actor: i.user,
        });
        await i.update(buildAntifastPanel(i.guild));
        return;
      }

      if (i.isUserSelectMenu() && (i.customId === "antifast_wl_add" || i.customId === "antifast_wl_remove")) {
        const targetId = i.values[0];
        const adding = i.customId === "antifast_wl_add";
        if (adding) addToWhitelist(i.guild.id, targetId);
        else removeFromWhitelist(i.guild.id, targetId);
        await saveGuildConfig(i.guild);
        sendLog(i.client, i.guild.id, "securite", {
          title: adding ? "Whitelist anti-nuke — ajout" : "Whitelist anti-nuke — retrait",
          description: `<@${targetId}> ${adding ? "ajouté à" : "retiré de"} la whitelist anti-nuke via le panel.`,
          actor: i.user,
        });
        await i.update(buildAntifastPanel(i.guild));
        return;
      }
    } catch (err) {
      console.error("[antiNukeCommands] Erreur dans le panel antifast :", err);
      await safeErrorReply(i);
    }
  });

  collector.on("end", () => {
    panelMessage.edit({ components: [] }).catch(() => {});
  });
}

/**
 * `.antifast` — ouvre le panel interactif (statut, activer/désactiver,
 * gestion owners/whitelist). `.antifast on|off` reste un raccourci texte
 * rapide qui ne passe pas par le panel. Réservé aux "owners" anti-nuke (voir
 * isOwner) — jamais délégable via `.panel` > Permissions comme les autres
 * commandes, pour ne pas pouvoir être désactivé par un compte admin
 * compromis.
 * @param {import('discord.js').Message} message
 * @param {string[]} args
 */
async function handleAntifastCommand(message, args) {
  if (!isOwner(message.guild, message.author.id)) {
    return message.reply({
      embeds: [buildStatusEmbed("error", "Réservé aux owners anti-nuke (voir `.owner`).")],
    });
  }

  const sub = (args[0] || "").toLowerCase();
  if (!sub) {
    return handleAntifastPanel(message);
  }

  if (sub !== "on" && sub !== "off") {
    return message.reply({
      embeds: [buildStatusEmbed("error", "Utilisation : `.antifast` (statut), `.antifast on` ou `.antifast off`.")],
    });
  }

  setEnabled(message.guild.id, sub === "on");
  await saveGuildConfig(message.guild);
  sendLog(message.client, message.guild.id, "securite", {
    title: sub === "on" ? "Anti-nuke activé" : "Anti-nuke désactivé",
    description: `Anti-nuke ${sub === "on" ? "activé" : "désactivé"} via \`.antifast ${sub}\`.`,
    actor: message.author,
  });
  await message.reply({
    embeds: [buildStatusEmbed("success", `Anti-nuke **${sub === "on" ? "activé ✅" : "désactivé ❌"}**.`)],
  });
}

/**
 * `.owner add|remove|list [@membre]` — gère qui, en plus du vrai propriétaire
 * Discord du serveur, peut configurer l'anti-nuke (`.antifast`, `.wl`).
 * Volontairement réservé au propriétaire réel (`guild.ownerId`) ou à un
 * propriétaire du BOT (`BOT_OWNER_IDS`, valable sur tous les serveurs) —
 * jamais aux owners anti-nuke ajoutés via cette commande eux-mêmes, sinon un
 * owner ajouté par erreur (ou compromis) pourrait en ajouter d'autres en
 * chaîne.
 * @param {import('discord.js').Message} message
 * @param {string[]} args
 */
async function handleOwnerCommand(message, args) {
  if (message.author.id !== message.guild.ownerId && !isBotOwner(message.author.id)) {
    return message.reply({
      embeds: [buildStatusEmbed("error", "Réservé au propriétaire du serveur (ou du bot).")],
    });
  }

  const sub = (args[0] || "").toLowerCase();

  if (sub === "list" || !sub) {
    const owners = getOwners(message.guild.id);
    return message.reply({
      embeds: [
        buildStatusEmbed(
          "info",
          owners.length ? owners.map((id) => `<@${id}>`).join(", ") : "Aucun owner ajouté (juste toi, le propriétaire).",
          { title: "Owners anti-nuke" }
        ),
      ],
    });
  }

  if (sub !== "add" && sub !== "remove") {
    return message.reply({
      embeds: [buildStatusEmbed("error", "Utilisation : `.owner add @membre`, `.owner remove @membre` ou `.owner list`.")],
    });
  }

  const targetId = resolveMemberArg(message.guild, args[1]);
  if (!targetId) {
    return message.reply({ embeds: [buildStatusEmbed("error", "Mentionne un membre ou donne son ID.")] });
  }

  if (sub === "add") {
    addOwner(message.guild.id, targetId);
    await saveGuildConfig(message.guild);
    sendLog(message.client, message.guild.id, "securite", {
      title: "Owner anti-nuke ajouté",
      description: `<@${targetId}> ajouté aux owners anti-nuke via \`.owner add\`.`,
      actor: message.author,
    });
    return message.reply({ embeds: [buildStatusEmbed("success", `<@${targetId}> est maintenant owner anti-nuke.`)] });
  }

  removeOwner(message.guild.id, targetId);
  await saveGuildConfig(message.guild);
  sendLog(message.client, message.guild.id, "securite", {
    title: "Owner anti-nuke retiré",
    description: `<@${targetId}> retiré des owners anti-nuke via \`.owner remove\`.`,
    actor: message.author,
  });
  await message.reply({ embeds: [buildStatusEmbed("success", `<@${targetId}> n'est plus owner anti-nuke.`)] });
}

/**
 * `.wl add|remove|list [@membre]` — liste des membres exemptés des
 * déclencheurs anti-nuke (en plus du propriétaire, des owners et du bot).
 * Gérée par les owners anti-nuke (voir isOwner), contrairement à `.owner`
 * qui reste au seul vrai propriétaire.
 * @param {import('discord.js').Message} message
 * @param {string[]} args
 */
async function handleWhitelistCommand(message, args) {
  if (!isOwner(message.guild, message.author.id)) {
    return message.reply({
      embeds: [buildStatusEmbed("error", "Réservé aux owners anti-nuke (voir `.owner`).")],
    });
  }

  const sub = (args[0] || "").toLowerCase();

  if (sub === "list" || !sub) {
    const whitelist = getWhitelist(message.guild.id);
    return message.reply({
      embeds: [
        buildStatusEmbed(
          "info",
          whitelist.length ? whitelist.map((id) => `<@${id}>`).join(", ") : "Personne sur la whitelist.",
          { title: "Whitelist anti-nuke" }
        ),
      ],
    });
  }

  if (sub !== "add" && sub !== "remove") {
    return message.reply({
      embeds: [buildStatusEmbed("error", "Utilisation : `.wl add @membre`, `.wl remove @membre` ou `.wl list`.")],
    });
  }

  const targetId = resolveMemberArg(message.guild, args[1]);
  if (!targetId) {
    return message.reply({ embeds: [buildStatusEmbed("error", "Mentionne un membre ou donne son ID.")] });
  }

  if (sub === "add") {
    addToWhitelist(message.guild.id, targetId);
    await saveGuildConfig(message.guild);
    sendLog(message.client, message.guild.id, "securite", {
      title: "Whitelist anti-nuke — ajout",
      description: `<@${targetId}> ajouté à la whitelist anti-nuke via \`.wl add\`.`,
      actor: message.author,
    });
    return message.reply({ embeds: [buildStatusEmbed("success", `<@${targetId}> ajouté à la whitelist anti-nuke.`)] });
  }

  removeFromWhitelist(message.guild.id, targetId);
  await saveGuildConfig(message.guild);
  sendLog(message.client, message.guild.id, "securite", {
    title: "Whitelist anti-nuke — retrait",
    description: `<@${targetId}> retiré de la whitelist anti-nuke via \`.wl remove\`.`,
    actor: message.author,
  });
  await message.reply({ embeds: [buildStatusEmbed("success", `<@${targetId}> retiré de la whitelist anti-nuke.`)] });
}

module.exports = { handleAntifastCommand, handleOwnerCommand, handleWhitelistCommand };
