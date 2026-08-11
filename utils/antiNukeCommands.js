const {
  ContainerBuilder,
  TextDisplayBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
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
  getRoleBypass,
  setRoleBypass,
  getCategoryBypass,
  setCategoryBypass,
  getModuleOverride,
  setModuleOverride,
  getAutoRestoreMs,
  setAutoRestoreMs,
} = require("./antiNukeStore");
const { MODULE_GROUPS, MODULE_LABELS, ALL_MODULES } = require("./antiNukeModules");
const { DEFAULT_THRESHOLDS, DEFAULT_WINDOW_MS } = require("./antiNuke");
const { saveGuildConfig } = require("./configChannel");
const { sendLog } = require("./actionLogger");
const { fetchAllMembers, memberFetchErrorMessage } = require("./guildMembers");

const PANEL_TIMEOUT_MS = 10 * 60_000;
const PAGE_SIZE = 10;

const MODULE_KEY_LOOKUP = Object.fromEntries(ALL_MODULES.map((m) => [m.toLowerCase(), m]));
const GROUP_KEY_LOOKUP = Object.fromEntries(Object.keys(MODULE_GROUPS).map((g) => [g.toLowerCase(), g]));

function resolveMemberArg(guild, raw) {
  if (!raw) return null;
  const id = raw.replace(/[<@!>]/g, "");
  return /^\d{15,}$/.test(id) ? id : null;
}

/**
 * Interprète le 3e argument de `=wl add/remove` : `all`, une catégorie
 * (voir MODULE_GROUPS, ex: "roles", "salons") ou un module précis (voir
 * ALL_MODULES, ex: "roleCreate"). Insensible à la casse. Par défaut (rien
 * fourni) : "all", pour rester pratique comme `.wl <id> all` sur d'autres bots.
 * @param {string} [raw]
 * @returns {string[]|null} liste de clés de module, ou null si invalide
 */
function resolveModulesArg(raw) {
  if (!raw) return ["all"];
  const key = raw.toLowerCase();
  if (key === "all") return ["all"];
  if (GROUP_KEY_LOOKUP[key]) return Object.keys(MODULE_GROUPS[GROUP_KEY_LOOKUP[key]].modules);
  if (MODULE_KEY_LOOKUP[key]) return [MODULE_KEY_LOOKUP[key]];
  return null;
}

function formatModules(modules) {
  if (!modules || modules.length === 0) return "*aucun*";
  if (modules.includes("all")) return "**Tout**";
  return modules.map((m) => MODULE_LABELS[m] || m).join(", ");
}

function formatDuration(ms) {
  if (!ms || ms <= 0) return null;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.round(totalSeconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

function buildListPanel(title, entries, page, formatEntry) {
  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(page, 0), totalPages - 1);
  const pageEntries = entries.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${title}\n> Nombre actuel : **${entries.length}** — Page ${clampedPage + 1}/${totalPages}\n\n` +
        (pageEntries.length
          ? pageEntries.map((entry, i) => formatEntry(entry, clampedPage * PAGE_SIZE + i + 1)).join("\n")
          : "*Aucune entrée.*")
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("list_prev").setLabel("◀️ Précédent").setStyle(ButtonStyle.Secondary).setDisabled(clampedPage === 0),
      new ButtonBuilder().setCustomId("list_next").setLabel("▶️ Suivant").setStyle(ButtonStyle.Secondary).setDisabled(clampedPage >= totalPages - 1)
    )
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Envoie une liste paginée générique (owners, whitelist, bots...) avec deux
 * boutons Précédent/Suivant. `entries` est un instantané figé au moment de
 * l'appel (pas de re-fetch en changeant de page).
 * @param {import('discord.js').Message} message
 * @param {string} title
 * @param {any[]} entries
 * @param {(entry: any, number: number) => string} formatEntry
 */
async function sendPaginatedList(message, title, entries, formatEntry) {
  let page = 0;
  const panelMessage = await message.reply(buildListPanel(title, entries, page, formatEntry));

  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });
  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== message.author.id) {
        await i.reply({ content: "Seul l'auteur de la commande peut naviguer dans cette liste.", ephemeral: true });
        return;
      }
      if (i.customId === "list_prev") page -= 1;
      else if (i.customId === "list_next") page += 1;
      else return;
      await i.update(buildListPanel(title, entries, page, formatEntry));
    } catch (err) {
      console.error("[antiNukeCommands] Erreur de pagination :", err);
    }
  });

  collector.on("end", () => {
    panelMessage.edit({ components: [] }).catch(() => {});
  });
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

// ---------------------------------------------------------------------------
// Panel principal =antifast
// ---------------------------------------------------------------------------

function buildAntifastPanel(guild) {
  const enabled = isEnabled(guild.id);
  const owners = getOwners(guild.id);
  const whitelist = Object.entries(getWhitelist(guild.id));
  const roleBypass = getRoleBypass(guild.id);
  const categoryBypass = getCategoryBypass(guild.id);
  const autoRestoreMs = getAutoRestoreMs(guild.id);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Anti-nuke ("antifast")\n> Statut : **${enabled ? "Activé ✅" : "Désactivé ❌"}**\n\n` +
        `**Owners** (en plus du propriétaire réel) : ${owners.length ? owners.map((id) => `<@${id}>`).join(", ") : "*aucun*"}\n` +
        `**Whitelist** (${whitelist.length}) : ${
          whitelist.length ? whitelist.map(([id, modules]) => `<@${id}> (${formatModules(modules)})`).join(", ") : "*aucune*"
        }\n` +
        `**Rôles bypass** : ${roleBypass.length ? roleBypass.map((id) => `<@&${id}>`).join(", ") : "*aucun*"}\n` +
        `**Catégories bypass** : ${categoryBypass.length ? categoryBypass.map((id) => `<#${id}>`).join(", ") : "*aucune*"}\n` +
        `**Réactivation auto** : ${autoRestoreMs > 0 ? `après ${formatDuration(autoRestoreMs)}` : "désactivée"}\n\n` +
        `-# ${ALL_MODULES.length} modules surveillés. Boutons ci-dessous pour tout gérer.`
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
      new ButtonBuilder().setCustomId("antifast_open_owners").setLabel("👑 Owners").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("antifast_open_whitelist").setLabel("🛡️ Whitelist").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("antifast_open_advanced").setLabel("⚙️ Avancé").setStyle(ButtonStyle.Secondary)
    )
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildOwnersSubPanel() {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Owners anti-nuke\n> Réservé au propriétaire réel du serveur (ou du bot).")
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId("antifast_owner_add").setPlaceholder("➕ Ajouter un owner").setMinValues(1).setMaxValues(1)
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId("antifast_owner_remove").setPlaceholder("➖ Retirer un owner").setMinValues(1).setMaxValues(1)
    )
  );
  return { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] };
}

function buildWhitelistSubPanel() {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Whitelist anti-nuke\n> Ces menus exemptent de **tout**. Pour une exemption précise, utilise `=wl add @membre <module|catégorie>`."
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId("antifast_wl_add").setPlaceholder("➕ Whitelister un membre (tout)").setMinValues(1).setMaxValues(1)
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId("antifast_wl_remove").setPlaceholder("➖ Retirer un membre (tout)").setMinValues(1).setMaxValues(1)
    )
  );
  return { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] };
}

function buildAdvancedPanel(guild) {
  const roleBypass = getRoleBypass(guild.id);
  const categoryBypass = getCategoryBypass(guild.id);
  const autoRestoreMs = getAutoRestoreMs(guild.id);

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Anti-nuke — Avancé\n" +
        `**Rôles bypass** : ${roleBypass.length ? roleBypass.map((id) => `<@&${id}>`).join(", ") : "*aucun*"}\n` +
        `**Catégories bypass** : ${categoryBypass.length ? categoryBypass.map((id) => `<#${id}>`).join(", ") : "*aucune*"}\n` +
        `**Réactivation auto des rôles retirés** : ${
          autoRestoreMs > 0 ? `après ${formatDuration(autoRestoreMs)}` : "désactivée (retrait permanent)"
        }`
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId("antifast_adv_role_bypass")
        .setPlaceholder("Rôles bypass (remplace la liste, vide = aucun)")
        .setMinValues(0)
        .setMaxValues(10)
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId("antifast_adv_cat_bypass")
        .setPlaceholder("Catégories bypass (remplace la liste, vide = aucune)")
        .setChannelTypes(ChannelType.GuildCategory)
        .setMinValues(0)
        .setMaxValues(10)
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("antifast_adv_restore").setLabel("⏱️ Réactivation auto").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("antifast_adv_modules").setLabel("🎯 Configurer un module").setStyle(ButtonStyle.Secondary)
    )
  );
  return { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] };
}

function buildModuleCategoryPanel() {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Configurer un module\n> Choisis une catégorie."));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("antifast_module_category")
        .setPlaceholder("Choisir une catégorie")
        .addOptions(Object.entries(MODULE_GROUPS).map(([key, g]) => ({ label: g.label, value: key })))
    )
  );
  return { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] };
}

function buildModuleListPanel(groupKey) {
  const group = MODULE_GROUPS[groupKey];
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${group.label}\n> Choisis un module à configurer.`));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("antifast_module_select")
        .setPlaceholder("Choisir un module")
        .addOptions(Object.entries(group.modules).map(([key, label]) => ({ label, value: key })))
    )
  );
  return { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] };
}

function buildModuleDetailPanel(guild, moduleKey) {
  const override = getModuleOverride(guild.id, moduleKey);
  const threshold = override.threshold ?? DEFAULT_THRESHOLDS[moduleKey];
  const windowMs = override.windowMs ?? DEFAULT_WINDOW_MS;
  const paused = Boolean(override.paused);
  const isCustom = override.threshold != null || override.windowMs != null;

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## ${MODULE_LABELS[moduleKey]}\n` +
        `> Statut : **${paused ? "En pause ⏸️" : "Actif ✅"}**\n` +
        `> Seuil : **${threshold}** action(s) en **${Math.round(windowMs / 1000)}s**${isCustom ? " *(personnalisé)*" : " *(par défaut)*"}`
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`antifast_module_pause:${moduleKey}`)
        .setLabel(paused ? "▶️ Reprendre" : "⏸️ Mettre en pause")
        .setStyle(paused ? ButtonStyle.Success : ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`antifast_module_threshold:${moduleKey}`).setLabel("🎯 Régler le seuil").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`antifast_module_reset:${moduleKey}`).setLabel("↩️ Défaut").setStyle(ButtonStyle.Secondary)
    )
  );
  return { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [container] };
}

function buildThresholdModal(moduleKey, threshold, windowMs) {
  return new ModalBuilder()
    .setCustomId(`antifast_threshold_modal:${moduleKey}`)
    .setTitle(`Seuil — ${MODULE_LABELS[moduleKey]}`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("threshold")
          .setLabel("Nombre d'actions avant déclenchement")
          .setStyle(TextInputStyle.Short)
          .setValue(String(threshold))
          .setRequired(true)
          .setMaxLength(3)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("window")
          .setLabel("Délai (en secondes)")
          .setStyle(TextInputStyle.Short)
          .setValue(String(Math.round(windowMs / 1000)))
          .setRequired(true)
          .setMaxLength(4)
      )
    );
}

function buildRestoreModal(currentMs) {
  return new ModalBuilder()
    .setCustomId("antifast_restore_modal")
    .setTitle("Réactivation automatique")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("minutes")
          .setLabel("Délai en minutes (0 = désactivée)")
          .setStyle(TextInputStyle.Short)
          .setValue(String(Math.round(currentMs / 60000)))
          .setRequired(true)
          .setMaxLength(5)
      )
    );
}

/**
 * Panel interactif `=antifast` (sans argument) : statut, activer/désactiver,
 * et trois boutons ouvrant chacun un sous-panel dédié (owners, whitelist,
 * avancé) — nécessaire car Discord limite un message à 5 lignes de
 * composants, largement dépassé si tout était sur un seul écran vu le
 * nombre de réglages (bypass rôles/catégories, réactivation auto,
 * configuration des 30 modules...). Toujours réservé aux owners anti-nuke ;
 * ajouter/retirer un owner reste en plus réservé au propriétaire réel du
 * serveur ou du bot.
 * @param {import('discord.js').Message} message
 */
async function handleAntifastPanel(message) {
  const panelMessage = await message.reply(buildAntifastPanel(message.guild));
  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });

  collector.on("collect", async (i) => {
    try {
      if (!isOwner(i.guild, i.user.id)) {
        await i.reply({ content: "Réservé aux owners anti-nuke (voir `=owner`).", ephemeral: true });
        return;
      }

      if (i.isButton() && i.customId === "antifast_toggle") {
        const nowEnabled = !isEnabled(i.guild.id);
        setEnabled(i.guild.id, nowEnabled);
        await saveGuildConfig(i.guild, ["antiNuke"]);
        sendLog(i.client, i.guild.id, "securite", {
          title: nowEnabled ? "Anti-nuke activé" : "Anti-nuke désactivé",
          description: `Anti-nuke ${nowEnabled ? "activé" : "désactivé"} via le panel.`,
          actor: i.user,
        });
        await i.update(buildAntifastPanel(i.guild));
        return;
      }

      if (i.isButton() && i.customId === "antifast_open_owners") {
        await handleOwnersSubPanel(i, message);
        return;
      }
      if (i.isButton() && i.customId === "antifast_open_whitelist") {
        await handleWhitelistSubPanel(i, message);
        return;
      }
      if (i.isButton() && i.customId === "antifast_open_advanced") {
        await handleAdvancedSubPanel(i, message);
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

async function handleOwnersSubPanel(i, message) {
  const subMessage = await i.reply({ ...buildOwnersSubPanel(), fetchReply: true });
  const subCollector = subMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });

  subCollector.on("collect", async (sub) => {
    try {
      if (sub.user.id !== i.guild.ownerId && !isBotOwner(sub.user.id)) {
        await sub.reply({ content: "Réservé au propriétaire du serveur (ou du bot).", ephemeral: true });
        return;
      }
      const targetId = sub.values[0];
      const adding = sub.customId === "antifast_owner_add";
      if (adding) addOwner(sub.guild.id, targetId);
      else removeOwner(sub.guild.id, targetId);
      await saveGuildConfig(sub.guild, ["antiNuke"]);
      sendLog(sub.client, sub.guild.id, "securite", {
        title: adding ? "Owner anti-nuke ajouté" : "Owner anti-nuke retiré",
        description: `<@${targetId}> ${adding ? "ajouté aux" : "retiré des"} owners anti-nuke via le panel.`,
        actor: sub.user,
      });
      await sub.update(buildOwnersSubPanel());
    } catch (err) {
      console.error("[antiNukeCommands] Erreur sous-panel owners :", err);
      await safeErrorReply(sub);
    }
  });
}

async function handleWhitelistSubPanel(i, message) {
  const subMessage = await i.reply({ ...buildWhitelistSubPanel(), fetchReply: true });
  const subCollector = subMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });

  subCollector.on("collect", async (sub) => {
    try {
      const targetId = sub.values[0];
      const adding = sub.customId === "antifast_wl_add";
      if (adding) addToWhitelist(sub.guild.id, targetId, ["all"]);
      else removeFromWhitelist(sub.guild.id, targetId, ["all"]);
      await saveGuildConfig(sub.guild, ["antiNuke"]);
      sendLog(sub.client, sub.guild.id, "securite", {
        title: adding ? "Whitelist anti-nuke — ajout" : "Whitelist anti-nuke — retrait",
        description: `<@${targetId}> ${adding ? "ajouté à" : "retiré de"} la whitelist anti-nuke (tout) via le panel.`,
        actor: sub.user,
      });
      await sub.update(buildWhitelistSubPanel());
    } catch (err) {
      console.error("[antiNukeCommands] Erreur sous-panel whitelist :", err);
      await safeErrorReply(sub);
    }
  });
}

async function handleAdvancedSubPanel(i, message) {
  const subMessage = await i.reply({ ...buildAdvancedPanel(i.guild), fetchReply: true });
  const subCollector = subMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });
  let currentGroupKey = null;

  subCollector.on("collect", async (sub) => {
    try {
      if (sub.isRoleSelectMenu() && sub.customId === "antifast_adv_role_bypass") {
        setRoleBypass(sub.guild.id, sub.values);
        await saveGuildConfig(sub.guild, ["antiNuke"]);
        sendLog(sub.client, sub.guild.id, "securite", {
          title: "Rôles bypass anti-nuke modifiés",
          description: `Nouveaux rôles bypass : ${sub.values.length ? sub.values.map((id) => `<@&${id}>`).join(", ") : "*aucun*"}.`,
          actor: sub.user,
        });
        await sub.update(buildAdvancedPanel(sub.guild));
        return;
      }

      if (sub.isChannelSelectMenu() && sub.customId === "antifast_adv_cat_bypass") {
        setCategoryBypass(sub.guild.id, sub.values);
        await saveGuildConfig(sub.guild, ["antiNuke"]);
        sendLog(sub.client, sub.guild.id, "securite", {
          title: "Catégories bypass anti-nuke modifiées",
          description: `Nouvelles catégories bypass : ${sub.values.length ? sub.values.map((id) => `<#${id}>`).join(", ") : "*aucune*"}.`,
          actor: sub.user,
        });
        await sub.update(buildAdvancedPanel(sub.guild));
        return;
      }

      if (sub.isButton() && sub.customId === "antifast_adv_restore") {
        await sub.showModal(buildRestoreModal(getAutoRestoreMs(sub.guild.id)));
        const submitted = await sub
          .awaitModalSubmit({ time: PANEL_TIMEOUT_MS, filter: (m) => m.customId === "antifast_restore_modal" && m.user.id === sub.user.id })
          .catch(() => null);
        if (!submitted) return;

        const minutes = parseInt(submitted.fields.getTextInputValue("minutes").trim(), 10);
        if (!Number.isInteger(minutes) || minutes < 0 || minutes > 10_000) {
          await submitted.reply({ content: "Nombre de minutes invalide.", ephemeral: true });
          return;
        }
        setAutoRestoreMs(sub.guild.id, minutes * 60_000);
        await saveGuildConfig(sub.guild, ["antiNuke"]);
        sendLog(sub.client, sub.guild.id, "securite", {
          title: "Réactivation automatique modifiée",
          description: minutes > 0 ? `Réactivation auto réglée sur ${minutes} min.` : "Réactivation auto désactivée.",
          actor: sub.user,
        });
        await submitted.update(buildAdvancedPanel(sub.guild));
        return;
      }

      if (sub.isButton() && sub.customId === "antifast_adv_modules") {
        await sub.update(buildModuleCategoryPanel());
        return;
      }

      if (sub.isStringSelectMenu() && sub.customId === "antifast_module_category") {
        currentGroupKey = sub.values[0];
        await sub.update(buildModuleListPanel(currentGroupKey));
        return;
      }

      if (sub.isStringSelectMenu() && sub.customId === "antifast_module_select") {
        await sub.update(buildModuleDetailPanel(sub.guild, sub.values[0]));
        return;
      }

      if (sub.isButton() && sub.customId.startsWith("antifast_module_pause:")) {
        const moduleKey = sub.customId.split(":")[1];
        const override = getModuleOverride(sub.guild.id, moduleKey);
        setModuleOverride(sub.guild.id, moduleKey, { paused: !override.paused });
        await saveGuildConfig(sub.guild, ["antiNuke"]);
        sendLog(sub.client, sub.guild.id, "securite", {
          title: "Module anti-nuke modifié",
          description: `**${MODULE_LABELS[moduleKey]}** ${!override.paused ? "mis en pause" : "réactivé"} via le panel.`,
          actor: sub.user,
        });
        await sub.update(buildModuleDetailPanel(sub.guild, moduleKey));
        return;
      }

      if (sub.isButton() && sub.customId.startsWith("antifast_module_reset:")) {
        const moduleKey = sub.customId.split(":")[1];
        setModuleOverride(sub.guild.id, moduleKey, { threshold: undefined, windowMs: undefined });
        await saveGuildConfig(sub.guild, ["antiNuke"]);
        await sub.update(buildModuleDetailPanel(sub.guild, moduleKey));
        return;
      }

      if (sub.isButton() && sub.customId.startsWith("antifast_module_threshold:")) {
        const moduleKey = sub.customId.split(":")[1];
        const override = getModuleOverride(sub.guild.id, moduleKey);
        const threshold = override.threshold ?? DEFAULT_THRESHOLDS[moduleKey];
        const windowMs = override.windowMs ?? DEFAULT_WINDOW_MS;
        await sub.showModal(buildThresholdModal(moduleKey, threshold, windowMs));

        const submitted = await sub
          .awaitModalSubmit({
            time: PANEL_TIMEOUT_MS,
            filter: (m) => m.customId === `antifast_threshold_modal:${moduleKey}` && m.user.id === sub.user.id,
          })
          .catch(() => null);
        if (!submitted) return;

        const newThreshold = parseInt(submitted.fields.getTextInputValue("threshold").trim(), 10);
        const newWindowSeconds = parseInt(submitted.fields.getTextInputValue("window").trim(), 10);
        if (!Number.isInteger(newThreshold) || newThreshold < 1 || newThreshold > 100) {
          await submitted.reply({ content: "Nombre d'actions invalide (1 à 100).", ephemeral: true });
          return;
        }
        if (!Number.isInteger(newWindowSeconds) || newWindowSeconds < 1 || newWindowSeconds > 3600) {
          await submitted.reply({ content: "Délai invalide (1 à 3600 secondes).", ephemeral: true });
          return;
        }

        setModuleOverride(sub.guild.id, moduleKey, { threshold: newThreshold, windowMs: newWindowSeconds * 1000 });
        await saveGuildConfig(sub.guild, ["antiNuke"]);
        sendLog(sub.client, sub.guild.id, "securite", {
          title: "Module anti-nuke modifié",
          description: `**${MODULE_LABELS[moduleKey]}** : seuil réglé sur ${newThreshold} action(s) / ${newWindowSeconds}s via le panel.`,
          actor: sub.user,
        });
        await submitted.update(buildModuleDetailPanel(sub.guild, moduleKey));
        return;
      }
    } catch (err) {
      console.error("[antiNukeCommands] Erreur sous-panel avancé :", err);
      await safeErrorReply(sub);
    }
  });
}

/**
 * `=antifast` — ouvre le panel interactif (statut, activer/désactiver,
 * gestion owners/whitelist/avancé). `=antifast on|off` reste un raccourci
 * texte rapide qui ne passe pas par le panel. Réservé aux "owners" anti-nuke
 * (voir isOwner) — un cercle volontairement séparé de l'Administrateur
 * Discord natif (bot Musique+Modération), pour ne pas pouvoir être désactivé
 * par un compte admin compromis.
 * @param {import('discord.js').Message} message
 * @param {string[]} args
 */
async function handleAntifastCommand(message, args) {
  if (!isOwner(message.guild, message.author.id)) {
    return message.reply({
      embeds: [buildStatusEmbed("error", "Réservé aux owners anti-nuke (voir `=owner`).")],
    });
  }

  const sub = (args[0] || "").toLowerCase();
  if (!sub) {
    return handleAntifastPanel(message);
  }

  if (sub !== "on" && sub !== "off") {
    return message.reply({
      embeds: [buildStatusEmbed("error", "Utilisation : `=antifast` (panel), `=antifast on` ou `=antifast off`.")],
    });
  }

  setEnabled(message.guild.id, sub === "on");
  await saveGuildConfig(message.guild, ["antiNuke"]);
  sendLog(message.client, message.guild.id, "securite", {
    title: sub === "on" ? "Anti-nuke activé" : "Anti-nuke désactivé",
    description: `Anti-nuke ${sub === "on" ? "activé" : "désactivé"} via \`=antifast ${sub}\`.`,
    actor: message.author,
  });
  await message.reply({
    embeds: [buildStatusEmbed("success", `Anti-nuke **${sub === "on" ? "activé ✅" : "désactivé ❌"}**.`)],
  });
}

/**
 * `=owner add|remove|list [@membre]` — gère qui, en plus du vrai propriétaire
 * Discord du serveur, peut configurer l'anti-nuke (`=antifast`, `=wl`).
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
    return sendPaginatedList(message, "Liste des owners", owners, (id) => `<@${id}> (${id})`);
  }

  if (sub !== "add" && sub !== "remove") {
    return message.reply({
      embeds: [buildStatusEmbed("error", "Utilisation : `=owner add @membre`, `=owner remove @membre` ou `=owner list`.")],
    });
  }

  const targetId = resolveMemberArg(message.guild, args[1]);
  if (!targetId) {
    return message.reply({ embeds: [buildStatusEmbed("error", "Mentionne un membre ou donne son ID.")] });
  }

  if (sub === "add") {
    addOwner(message.guild.id, targetId);
    await saveGuildConfig(message.guild, ["antiNuke"]);
    sendLog(message.client, message.guild.id, "securite", {
      title: "Owner anti-nuke ajouté",
      description: `<@${targetId}> ajouté aux owners anti-nuke via \`=owner add\`.`,
      actor: message.author,
    });
    return message.reply({ embeds: [buildStatusEmbed("success", `<@${targetId}> est maintenant owner anti-nuke.`)] });
  }

  removeOwner(message.guild.id, targetId);
  await saveGuildConfig(message.guild, ["antiNuke"]);
  sendLog(message.client, message.guild.id, "securite", {
    title: "Owner anti-nuke retiré",
    description: `<@${targetId}> retiré des owners anti-nuke via \`=owner remove\`.`,
    actor: message.author,
  });
  await message.reply({ embeds: [buildStatusEmbed("success", `<@${targetId}> n'est plus owner anti-nuke.`)] });
}

/**
 * `=wl add|remove|list [@membre] [module|catégorie|all]` — membres exemptés
 * des déclencheurs anti-nuke, module par module (voir
 * utils/antiNukeModules.js) plutôt qu'une exemption plate. `all` (ou
 * l'argument omis) exempte tout d'un coup ; le nom d'une catégorie (ex:
 * `roles`, `salons`) exempte tous les modules de cette catégorie ; le nom
 * exact d'un module (ex: `roleCreate`) n'exempte que lui. Gérée par les
 * owners anti-nuke (voir isOwner), contrairement à `=owner` qui reste au
 * seul vrai propriétaire.
 * @param {import('discord.js').Message} message
 * @param {string[]} args
 */
async function handleWhitelistCommand(message, args) {
  if (!isOwner(message.guild, message.author.id)) {
    return message.reply({
      embeds: [buildStatusEmbed("error", "Réservé aux owners anti-nuke (voir `=owner`).")],
    });
  }

  const sub = (args[0] || "").toLowerCase();

  if (sub === "list" || !sub) {
    const entries = Object.entries(getWhitelist(message.guild.id));
    return sendPaginatedList(message, "Liste de la whitelist", entries, ([id, modules]) => `<@${id}> (${id}) — ${formatModules(modules)}`);
  }

  if (sub !== "add" && sub !== "remove") {
    return message.reply({
      embeds: [
        buildStatusEmbed(
          "error",
          `Utilisation : \`=wl add @membre [module|catégorie|all]\`, \`=wl remove @membre [module|catégorie|all]\` ou \`=wl list\`. Catégories : ${Object.keys(
            MODULE_GROUPS
          ).join(", ")}.`
        ),
      ],
    });
  }

  const targetId = resolveMemberArg(message.guild, args[1]);
  if (!targetId) {
    return message.reply({ embeds: [buildStatusEmbed("error", "Mentionne un membre ou donne son ID.")] });
  }

  const modules = resolveModulesArg(args[2]);
  if (!modules) {
    return message.reply({
      embeds: [
        buildStatusEmbed(
          "error",
          `Module/catégorie invalide. Utilise \`all\`, une catégorie (${Object.keys(MODULE_GROUPS).join(", ")}) ou un module précis.`
        ),
      ],
    });
  }

  if (sub === "add") {
    addToWhitelist(message.guild.id, targetId, modules);
    await saveGuildConfig(message.guild, ["antiNuke"]);
    sendLog(message.client, message.guild.id, "securite", {
      title: "Whitelist anti-nuke — ajout",
      description: `<@${targetId}> ajouté à la whitelist anti-nuke via \`=wl add\` (${formatModules(modules)}).`,
      actor: message.author,
    });
    return message.reply({ embeds: [buildStatusEmbed("success", `<@${targetId}> whitelisté pour : ${formatModules(modules)}.`)] });
  }

  removeFromWhitelist(message.guild.id, targetId, modules);
  await saveGuildConfig(message.guild, ["antiNuke"]);
  sendLog(message.client, message.guild.id, "securite", {
    title: "Whitelist anti-nuke — retrait",
    description: `<@${targetId}> retiré de la whitelist anti-nuke via \`=wl remove\` (${formatModules(modules)}).`,
    actor: message.author,
  });
  await message.reply({ embeds: [buildStatusEmbed("success", `<@${targetId}> retiré de : ${formatModules(modules)}.`)] });
}

/**
 * `=allbots` — liste tous les bots présents sur le serveur, paginée (10 par
 * page). Utile pour repérer un bot ajouté sans autorisation — voir aussi le
 * module "Ajout d'un bot" de l'anti-nuke qui détecte ça en direct. Réservé
 * aux owners anti-nuke.
 * @param {import('discord.js').Message} message
 */
async function handleAllBotsCommand(message) {
  if (!isOwner(message.guild, message.author.id)) {
    return message.reply({
      embeds: [buildStatusEmbed("error", "Réservé aux owners anti-nuke (voir `=owner`).")],
    });
  }

  let members;
  try {
    members = await fetchAllMembers(message.guild);
  } catch (err) {
    console.error(err);
    return message.reply({
      embeds: [buildStatusEmbed("error", memberFetchErrorMessage(err) || "Impossible de récupérer la liste des membres, réessaie.")],
    });
  }

  const bots = [...members.filter((m) => m.user.bot).values()];
  return sendPaginatedList(message, "Liste des bots", bots, (member, n) => `${n}. <@${member.id}> (${member.user.tag}, ${member.id})`);
}

module.exports = { handleAntifastCommand, handleOwnerCommand, handleWhitelistCommand, handleAllBotsCommand };
