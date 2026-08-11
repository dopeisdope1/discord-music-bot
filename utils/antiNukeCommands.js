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
const { MODULE_GROUPS, MODULE_LABELS, ALL_MODULES } = require("./antiNukeModules");
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

function buildAntifastPanel(guild) {
  const enabled = isEnabled(guild.id);
  const owners = getOwners(guild.id);
  const whitelist = Object.entries(getWhitelist(guild.id));

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Anti-nuke ("antifast")\n> Statut : **${enabled ? "Activé ✅" : "Désactivé ❌"}**\n\n` +
        `**Owners** (en plus du propriétaire réel du serveur) : ${
          owners.length ? owners.map((id) => `<@${id}>`).join(", ") : "*aucun*"
        }\n` +
        `**Whitelist** (${whitelist.length}) : ${
          whitelist.length ? whitelist.map(([id, modules]) => `<@${id}> (${formatModules(modules)})`).join(", ") : "*aucune*"
        }\n\n` +
        `-# ${ALL_MODULES.length} modules surveillés. \`=wl add/remove @membre [module]\` pour une exemption précise — les menus ci-dessous exemptent de **tout**.`
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
        .setPlaceholder("➕ Whitelister un membre (tout)")
        .setMinValues(1)
        .setMaxValues(1)
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId("antifast_wl_remove")
        .setPlaceholder("➖ Retirer un membre de la whitelist (tout)")
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
 * Panel interactif `=antifast` (sans argument) : statut + bouton
 * activer/désactiver + menus pour gérer owners et whitelist (exemption
 * totale — voir `=wl add/remove @membre <module>` pour une exemption
 * précise). Toujours réservé aux owners anti-nuke pour voir/interagir avec
 * le panel ; ajouter/retirer un owner reste en plus réservé au propriétaire
 * réel du serveur ou du bot (mêmes règles que `=owner`, vérifiées à nouveau
 * ici — un owner délégué peut voir le panel mais pas cliquer sur ces deux
 * menus précis).
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
        if (adding) addToWhitelist(i.guild.id, targetId, ["all"]);
        else removeFromWhitelist(i.guild.id, targetId, ["all"]);
        await saveGuildConfig(i.guild);
        sendLog(i.client, i.guild.id, "securite", {
          title: adding ? "Whitelist anti-nuke — ajout" : "Whitelist anti-nuke — retrait",
          description: `<@${targetId}> ${adding ? "ajouté à" : "retiré de"} la whitelist anti-nuke (tout) via le panel.`,
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
 * `=antifast` — ouvre le panel interactif (statut, activer/désactiver,
 * gestion owners/whitelist). `=antifast on|off` reste un raccourci texte
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
  await saveGuildConfig(message.guild);
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
    await saveGuildConfig(message.guild);
    sendLog(message.client, message.guild.id, "securite", {
      title: "Owner anti-nuke ajouté",
      description: `<@${targetId}> ajouté aux owners anti-nuke via \`=owner add\`.`,
      actor: message.author,
    });
    return message.reply({ embeds: [buildStatusEmbed("success", `<@${targetId}> est maintenant owner anti-nuke.`)] });
  }

  removeOwner(message.guild.id, targetId);
  await saveGuildConfig(message.guild);
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
    await saveGuildConfig(message.guild);
    sendLog(message.client, message.guild.id, "securite", {
      title: "Whitelist anti-nuke — ajout",
      description: `<@${targetId}> ajouté à la whitelist anti-nuke via \`=wl add\` (${formatModules(modules)}).`,
      actor: message.author,
    });
    return message.reply({ embeds: [buildStatusEmbed("success", `<@${targetId}> whitelisté pour : ${formatModules(modules)}.`)] });
  }

  removeFromWhitelist(message.guild.id, targetId, modules);
  await saveGuildConfig(message.guild);
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
