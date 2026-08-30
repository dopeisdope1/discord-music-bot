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
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");
const { getPrefixes, setPrefix } = require("./prefixStore");
const accessStore = require("./accessStore");
const { can } = require("./permissions/engine");
const permCatalog = require("./permissions/catalog");
const permStore = require("./permissions/store");
const { PROFILES, getProfile } = require("./permissions/profiles");
const { sweepGuild } = require("./permissions/cleanup");
const { checkBotPermission } = require("./moderation/actions");
const { getAllLogChannels, setLogChannelId, CATEGORY_LABELS: LOG_CATEGORY_LABELS } = require("./modLogStore");
const historyStore = require("./moderationHistoryStore");
const automod = require("./automod/antiSpam");
const antiLink = require("./automod/antiLink");
const antiMention = require("./automod/antiMention");
const badWords = require("./automod/badWords");
const welcomeStore = require("./welcomeStore");
const guardConfig = require("./guard/config");
const guardWhitelist = require("./guard/whitelist");
const { DEFINITIONS: GUARD_DEFINITIONS } = require("./guard/definitions");

// Noms donnés aux salons créés par le bouton "Créer les salons
// automatiquement" (rubrique Logs) — ASCII simple, pas d'accent, pour éviter
// tout souci d'encodage sur un nom de salon.
const LOG_CHANNEL_NAMES = {
  moderation: "logs-moderation",
  members: "logs-membres",
  server: "logs-serveur",
  bots: "logs-bots",
  messages: "logs-messages",
};

// Préréglages pour la rubrique Bienvenue — 0 = jamais supprimé.
const WELCOME_DELETE_OPTIONS = [
  { label: "10 secondes", seconds: 10 },
  { label: "30 secondes", seconds: 30 },
  { label: "1 minute", seconds: 60 },
  { label: "5 minutes", seconds: 300 },
  { label: "Jamais", seconds: 0 },
];

/**
 * Crée un salon par catégorie de logs qui n'en a pas encore (ou dont le
 * salon configuré a été supprimé) — regroupés dans une catégorie "Logs"
 * (réutilisée si elle existe déjà). Chaque salon est masqué à @everyone :
 * la permission Discord Administrateur passe outre les restrictions de
 * salon, donc seuls les administrateurs le voient, sans rien à configurer
 * de plus. Idempotent : ne recrée jamais un salon pour une catégorie déjà
 * configurée avec un salon qui existe encore.
 * @param {import('discord.js').Guild} guild
 * @returns {Promise<{ created: { category: string, channel: import('discord.js').TextChannel }[] }>}
 */
async function createLogChannelsAutomatically(guild) {
  const everyone = guild.roles.everyone;
  const existing = getAllLogChannels(guild.id);

  const missing = Object.keys(LOG_CHANNEL_NAMES).filter((category) => {
    const channelId = existing[category];
    return !channelId || !guild.channels.cache.has(channelId);
  });
  if (!missing.length) return { created: [] };

  const hiddenFromEveryone = [{ id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] }];

  let parent = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === "Logs");
  if (!parent) {
    parent = await guild.channels.create({
      name: "Logs",
      type: ChannelType.GuildCategory,
      permissionOverwrites: hiddenFromEveryone,
      reason: "Création automatique des salons de logs (&panel > Logs)",
    });
  }

  const created = [];
  for (const category of missing) {
    const channel = await guild.channels.create({
      name: LOG_CHANNEL_NAMES[category],
      type: ChannelType.GuildText,
      parent: parent.id,
      permissionOverwrites: hiddenFromEveryone,
      reason: "Création automatique des salons de logs (&panel > Logs)",
    });
    setLogChannelId(guild.id, category, channel.id);
    created.push({ category, channel });
  }
  return { created };
}

// Tous les identifiants d'interaction du panneau commencent par "cfg:", ce
// qui permet à index.js de les router sans les énumérer un par un.
const ID = "cfg";

// Chaque rubrique déclare comment décider si elle est visible : `ownerOnly`
// (uniquement le propriétaire), `permission` (une clé du catalogue,
// résolue via engine.can — "sys" y compris, qui n'est jamais une clé
// octroyable et ne laisse donc passer QUE owner/sys, par construction de
// engine.can), ou `visible(member)` pour un besoin plus fin (ex : lecture
// OU écriture suffisent). Rien = toujours visible (page d'accueil).
const SECTIONS = [
  { key: "home", label: "Accueil", description: "Vue d'ensemble de la configuration" },
  { key: "prefixes", label: "Préfixes", description: "Préfixe musique et préfixe des commandes", permission: "sys" },
  { key: "moderation", label: "Dispenses", description: "Qui échappe au quota de nettoyage, ancien accès aux salons", permission: "sys" },
  { key: "permissions", label: "Permissions", description: "Permissions de modération par rôle", permission: "panel.permissions.manage" },
  { key: "profiles", label: "Profils", description: "Appliquer un profil prédéfini (Helper/Modérateur/Admin) à un rôle", permission: "panel.permissions.manage" },
  { key: "roles", label: "Rôles", description: "Nom, couleur, position, membres, permissions notables", permission: "panel.roles.manage" },
  {
    key: "logs",
    label: "Logs",
    description: "Salon de logs par catégorie (modération/membres/serveur/bots)",
    visible: (member) => can(member, "logs.view") || can(member, "logs.manage"),
  },
  { key: "history", label: "Historique", description: "Rechercher dans l'historique de modération", permission: "logs.view" },
  { key: "protection", label: "Protection", description: "Anti-spam et whitelist", permission: "protection.automod" },
  { key: "guard", label: "Anti-nuke", description: "Détection de rafales destructrices et sanction automatique", permission: "protection.guard.manage" },
  { key: "welcome", label: "Bienvenue", description: "Message de bienvenue à l'arrivée d'un membre", permission: "server.welcome.manage" },
  { key: "access", label: "Accès panel", description: "Qui a accès, nettoyage des accès obsolètes", permission: "sys" },
  { key: "sys", label: "Rang sys", description: "Qui a accès à tout le bot", ownerOnly: true },
  { key: "banall", label: "Ban de masse", description: "Qui peut lancer un ban de masse", ownerOnly: true },
];

function sectionVisible(section, member, isOwner) {
  if (section.key === "home") return true;
  if (section.ownerOnly) return isOwner;
  if (section.visible) return section.visible(member);
  return can(member, section.permission);
}

const sectionsFor = (member, isOwner) => SECTIONS.filter((s) => sectionVisible(s, member, isOwner));

/** Vrai si la personne a accès à AU MOINS une rubrique au-delà de l'accueil — condition d'entrée de &panel. */
function hasAnyPanelAccess(member) {
  const isOwner = accessStore.isOwner(member.id);
  return sectionsFor(member, isOwner).some((s) => s.key !== "home");
}

// Rubrique à rouvrir après avoir modifié une portée legacy (accessStore) :
// "clear" et "salon" vivent toutes deux sous "moderation" ici.
const SECTION_OF_SCOPE = { clear: "moderation", salon: "moderation", sys: "sys", banall: "banall" };

const mentions = (ids) => (ids.length ? ids.map((id) => `<@${id}>`).join(", ") : "*personne*");

function buildNav(current, member, isOwner) {
  return new StringSelectMenuBuilder()
    .setCustomId(`${ID}:nav`)
    .setPlaceholder("Choisis une rubrique à configurer")
    .addOptions(
      sectionsFor(member, isOwner).map((s) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(s.label)
          .setDescription(s.description.slice(0, 100))
          .setValue(s.key)
          .setDefault(s.key === current)
      )
    );
}

function permissionRows() {
  return permCatalog.byCategory().flatMap((group) => [
    `**${group.label}**`,
    ...group.permissions.map((p) => `> \`${p.key}\` — ${p.label}`),
  ]);
}

function sectionBody(section, guild, member, state) {
  const guildId = guild.id;
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
      `> **Accès legacy aux commandes de salon** : ${mentions(accessStore.list("salon"))}`,
      "Conservé pour rétrocompatibilité — la voie normale désormais est la rubrique **Permissions** " +
        "(clés `channels.lock` / `channels.manage`), octroyable par rôle.",
    ].join("\n");
  }

  if (section === "permissions") {
    const roleId = state.permissionsRoleId;
    if (!roleId) {
      return [
        "Choisis un rôle ci-dessous pour voir et modifier ses permissions de modération.",
        "",
        ...permissionRows(),
      ].join("\n");
    }
    const role = guild.roles.cache.get(roleId);
    if (!role) return "Ce rôle n'existe plus sur le serveur.";
    const granted = new Set(permStore.getRoleGrants(guildId, roleId));
    return [
      `**Rôle : ${role.toString()}**`,
      "",
      ...permCatalog.byCategory().map((group) => {
        const lines = group.permissions.map((p) => `[${granted.has(p.key) ? "x" : " "}] ${p.label}`);
        return `**${group.label}**\n${lines.join("\n")}`;
      }),
      "",
      "Sélectionne les permissions à accorder dans le menu ci-dessous — la sélection **remplace** l'ensemble actuel.",
    ].join("\n");
  }

  if (section === "profiles") {
    const roleId = state.profilesRoleId;
    const lines = PROFILES.map((p) => `> **${p.label}** — ${p.description}\n> ${p.permissions.map((k) => `\`${k}\``).join(", ")}`);
    if (!roleId) {
      return ["Choisis un rôle, puis un profil à lui appliquer (octroi en masse, éditable ensuite dans Permissions).", "", ...lines].join("\n");
    }
    const role = guild.roles.cache.get(roleId);
    if (!role) return "Ce rôle n'existe plus sur le serveur.";
    return [`**Rôle : ${role.toString()}**`, "", "Choisis le profil à lui appliquer :", "", ...lines].join("\n");
  }

  if (section === "roles") {
    const roleId = state.rolesRoleId;
    if (!roleId) return "Choisis un rôle ci-dessous pour voir ses informations.";
    const role = guild.roles.cache.get(roleId);
    if (!role) return "Ce rôle n'existe plus sur le serveur.";
    const notable = role.permissions.toArray().filter((p) =>
      ["Administrator", "BanMembers", "KickMembers", "ModerateMembers", "ManageRoles", "ManageChannels", "ManageGuild", "ManageMessages"].includes(p)
    );
    return [
      `**Nom** : ${role.name}`,
      `**ID** : \`${role.id}\``,
      `**Couleur** : ${role.hexColor}`,
      `**Position** : ${role.position} / ${guild.roles.cache.size}`,
      `**Membres** : ${role.members.size}`,
      `**Mentionnable** : ${role.mentionable ? "oui" : "non"}`,
      `**Permissions Discord notables** : ${notable.length ? notable.join(", ") : "*aucune*"}`,
      `**Permissions de modération accordées** : ${permStore.getRoleGrants(guildId, role.id).length}`,
    ].join("\n");
  }

  if (section === "logs") {
    const channels = getAllLogChannels(guildId);
    const manage = can(member, "logs.manage");
    const lines = Object.entries(channels).map(
      ([cat, chId]) => `> **${LOG_CATEGORY_LABELS[cat]}** : ${chId ? `<#${chId}>` : "*aucun — désactivé*"}`
    );
    const catLabel = state.logsCategory ? LOG_CATEGORY_LABELS[state.logsCategory] : null;
    return [
      ...lines,
      "",
      manage
        ? "Bouton \"Créer les salons automatiquement\" : crée un salon par catégorie manquante (visibles des " +
          "seuls membres avec la permission Discord Administrateur — elle passe outre les restrictions de " +
          "salon, rien d'autre à configurer)."
        : "Tu peux consulter cette configuration mais pas la modifier (droit `logs.manage` requis).",
      manage
        ? catLabel
          ? `Choisis le salon pour **${catLabel}** ci-dessous (valide sans rien choisir pour désactiver), ou choisis une autre catégorie dans le menu.`
          : "Ou choisis une catégorie dans le menu pour lui assigner un salon existant manuellement."
        : null,
      "Les messages postés ici ne s'effacent jamais, contrairement aux confirmations ailleurs dans le bot.",
    ]
      .filter((l) => l !== null)
      .join("\n");
  }

  if (section === "history") {
    const recent = historyStore.search(guildId, { limit: 5 });
    const lines = recent.map((e) => {
      const when = `<t:${Math.floor(new Date(e.createdAt).getTime() / 1000)}:R>`;
      return `> \`${e.action}\` ${e.targetTag ? `**${e.targetTag}**` : ""} — par ${e.moderatorTag || e.moderatorId} — ${when}`;
    });
    return [
      "**5 dernières actions :**",
      lines.length ? lines.join("\n") : "*Aucune entrée pour l'instant.*",
      "",
      "Utilise `&modlogs [@membre|id]` ou le bouton ci-dessous pour une recherche plus précise.",
    ].join("\n");
  }

  if (section === "protection") {
    const config = automod.getConfig(guildId);
    const whitelist = automod.getWhitelist(guildId);
    const linkConfig = antiLink.getConfig(guildId);
    const linkAllowed = antiLink.getAllowedChannels(guildId);
    const mentionConfig = antiMention.getConfig(guildId);
    const wordsConfig = badWords.getConfig(guildId);
    const words = badWords.getWords(guildId);
    return [
      `> **Anti-spam/anti-flood** : ${config.enabled ? "activé" : "désactivé"}`,
      `> Seuil : ${config.maxMessages} messages en ${config.windowSeconds}s déclenchent un timeout de ${config.timeoutSeconds}s`,
      "",
      `> **Anti-lien** : ${linkConfig.enabled ? "activé" : "désactivé"} (mode : ${linkConfig.mode === "all" ? "tous les liens" : "invitations Discord"})`,
      `> Salons exemptés : ${linkAllowed.length ? linkAllowed.map((id) => `<#${id}>`).join(", ") : "*aucun*"}`,
      "",
      `> **Anti-mass-mention** : ${mentionConfig.enabled ? "activé" : "désactivé"} (seuil : ${mentionConfig.maxMentions} mentions, timeout ${mentionConfig.timeoutSeconds}s)`,
      "",
      `> **Mots interdits** : ${wordsConfig.enabled ? "activé" : "désactivé"} (${words.length} mot(s) dans la liste)`,
      "",
      `> **Whitelist (exemptés)** : ${mentions([...whitelist.users, ...whitelist.roles])}`,
      "",
      "Cette whitelist exempte l'anti-spam, l'anti-lien, l'anti-mass-mention et les mots interdits. L'anti-@everyone " +
        "et l'anti-nuke ont leur propre whitelist, voir la rubrique **Anti-nuke**.",
    ].join("\n");
  }

  if (section === "guard") {
    const config = guardConfig.getConfig(guildId);
    const whitelist = guardWhitelist.getWhitelist(guildId);
    const guardLines = GUARD_DEFINITIONS.map((d) => {
      const rule = d.threshold ? `${d.threshold.count} en ${d.threshold.windowMs / 1000}s` : "immédiat";
      return `> \`${d.key}\` — ${d.label} (${rule})`;
    });
    return [
      `> **Anti-nuke** : ${config.enabled ? "activé" : "désactivé"}`,
      `> **Sanction** : ${config.punishment}${config.punishment === "timeout" ? ` (${config.punishmentDurationMs / 60000} min)` : ""}`,
      `> **Whitelist** : ${mentions([...whitelist.users, ...whitelist.roles])}`,
      "",
      "**Guards actifs :**",
      ...guardLines,
      "",
      "Owner, rang sys et whitelist sont entièrement exemptés (pas seulement de la sanction — leurs actions ne " +
        "comptent même pas dans les seuils). Pas de restauration de salon/rôle supprimé en v1 (voir le README) : " +
        "détection + sanction + log seulement, sauf ban/débannissement, simples à annuler.",
      "",
      "**Important** : ajoute le compte du CrowBot à cette whitelist pour éviter que ses propres actions " +
        "anti-nuke (dé-bannir quelqu'un, par exemple) ne soient elles-mêmes annulées par erreur.",
    ].join("\n");
  }

  if (section === "welcome") {
    const config = welcomeStore.getConfig(guildId);
    const lines = config.messages.length
      ? config.messages.map((m, i) => `${i + 1}. *${m}*`).join("\n")
      : "*Aucun message configuré — le message de bienvenue reste désactivé tant qu'il n'y en a pas au moins un.*";
    return [
      `> **Salon** : ${config.channelId ? `<#${config.channelId}>` : "*aucun — désactivé*"}`,
      `> **Suppression auto** : ${config.autoDeleteSeconds ? `${config.autoDeleteSeconds} secondes` : "jamais"}`,
      "",
      "**Messages** (un est tiré au hasard à chaque arrivée) :",
      lines,
    ].join("\n");
  }

  if (section === "access") {
    const rows = [];
    for (const userId of accessStore.list("sys")) rows.push([userId, "rang sys"]);
    for (const userId of accessStore.list("banall")) rows.push([userId, "ban de masse"]);
    for (const [userId, keys] of permStore.listUserGrants(guildId)) rows.push([userId, `octroi individuel (${keys.length})`]);

    const seen = new Set();
    const lines = rows
      .filter(([userId]) => (seen.has(userId) ? false : seen.add(userId)))
      .map(([userId]) => {
        const present = guild.members.cache.has(userId);
        return `> <@${userId}> — ${present ? "membre" : "absent du serveur"}`;
      });

    return [
      lines.length ? lines.join("\n") : "*Personne n'a d'accès individuel enregistré sur ce serveur.*",
      "",
      "Les octrois **par rôle** ne figurent pas ici : ils se recalculent automatiquement sur les rôles actuels " +
        "de chacun, rien à nettoyer de ce côté.",
      "Un départ du serveur révoque déjà l'accès automatiquement. Le bouton ci-dessous ne sert qu'à rattraper " +
        "un cas resté en place avant que ce nettoyage n'existe.",
    ].join("\n");
  }

  if (section === "sys") {
    return [
      `> **Rang sys** : ${mentions(accessStore.list("sys"))}`,
      "",
      "Le rang sys donne accès à **tout le bot** : toutes les permissions de modération, ce panneau, les dispenses.",
      "Un sys ne peut pas en nommer d'autres — cette rubrique n'est visible que par toi.",
    ].join("\n");
  }

  if (section === "banall") {
    return [
      `> **Autorisés** : ${mentions(accessStore.list("banall"))}`,
      "",
      "Ces membres peuvent lancer `banall`, qui bannit tout le serveur d'un coup.",
      "Le propriétaire du serveur y a toujours droit, sans figurer ici.",
      "Le rang sys ne suffit **pas**, ni aucun rôle : cet accès s'accorde un par un, et seulement par toi.",
    ].join("\n");
  }

  return [
    `> **Préfixe musique** : \`${prefixes.main}\``,
    `> **Préfixe des commandes** : \`${prefixes.musicMod}\``,
    `> **Propriétaire(s)** : ${mentions(owners)}`,
    `> **Rang sys** : ${mentions(accessStore.list("sys"))}`,
    `> **Rôles avec des permissions accordées** : ${permStore.listRoleGrants(guildId).length}`,
    "",
    "Sélectionne une rubrique ci-dessous pour la modifier — seules celles auxquelles tu as droit apparaissent.",
  ].join("\n");
}

/** Menus d'ajout/retrait pour une portée legacy (accessStore). */
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
 * @param {import('discord.js').Guild} guild
 * @param {string} current
 * @param {import('discord.js').GuildMember} member qui consulte/modifie le panneau
 * @param {{ permissionsRoleId?: string, profilesRoleId?: string, rolesRoleId?: string }} [state]
 */
function buildConfigPanel(guild, current = "home", member, state = {}) {
  const isOwner = accessStore.isOwner(member.id);
  const available = sectionsFor(member, isOwner);
  const meta = available.find((s) => s.key === current) || available[0];
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Configuration\n### ${meta.label}`)
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(sectionBody(meta.key, guild, member, state)));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(new ActionRowBuilder().addComponents(buildNav(meta.key, member, isOwner)));

  if (meta.key === "prefixes") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:prefix:main`).setLabel("Préfixe musique").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${ID}:prefix:musicMod`).setLabel("Préfixe commandes").setStyle(ButtonStyle.Secondary)
      )
    );
  } else if (meta.key === "moderation") {
    for (const row of accessRows("clear", "dispense de nettoyage")) container.addActionRowComponents(row);
    for (const row of accessRows("salon", "accès legacy aux salons")) container.addActionRowComponents(row);
  } else if (meta.key === "permissions") {
    // Trois étapes (rôle → catégorie → clés) plutôt qu'un unique menu avec
    // toutes les clés : Discord plafonne un menu à 25 options, et le
    // catalogue (utils/permissions/catalog.js) a vocation à grandir —
    // chaque catégorie reste largement sous la limite, indéfiniment.
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(`${ID}:permrole`).setPlaceholder("Choisir un rôle à configurer")
      )
    );
    if (state.permissionsRoleId && guild.roles.cache.has(state.permissionsRoleId)) {
      const categories = permCatalog.byCategory();
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ID}:permcat:${state.permissionsRoleId}`)
            .setPlaceholder("Choisir une catégorie de permissions")
            .addOptions(
              categories.map((c) =>
                new StringSelectMenuOptionBuilder().setLabel(c.label).setValue(c.category).setDefault(state.permissionsCategory === c.category)
              )
            )
        )
      );
      const activeCategory = categories.find((c) => c.category === state.permissionsCategory);
      if (activeCategory) {
        const granted = permStore.getRoleGrants(guild.id, state.permissionsRoleId);
        const options = activeCategory.permissions
          .filter((p) => p.roleGrantable !== false)
          .map((p) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(p.label.slice(0, 100))
              .setDescription(p.key)
              .setValue(p.key)
              .setDefault(granted.includes(p.key))
          );
        if (options.length) {
          container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new StringSelectMenuBuilder()
                .setCustomId(`${ID}:permkeys:${state.permissionsRoleId}:${activeCategory.category}`)
                .setPlaceholder(`Permissions "${activeCategory.label}" accordées à ce rôle`)
                .setMinValues(0)
                .setMaxValues(options.length)
                .addOptions(options)
            )
          );
        }
      }
    }
  } else if (meta.key === "profiles") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(`${ID}:profilerole`).setPlaceholder("Choisir un rôle")
      )
    );
    if (state.profilesRoleId && guild.roles.cache.has(state.profilesRoleId)) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ID}:profileapply:${state.profilesRoleId}`)
            .setPlaceholder("Appliquer un profil à ce rôle")
            .addOptions(
              PROFILES.map((p) => new StringSelectMenuOptionBuilder().setLabel(p.label).setDescription(p.description).setValue(p.key))
            )
        )
      );
    }
  } else if (meta.key === "roles") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(`${ID}:roleinfo`).setPlaceholder("Choisir un rôle")
      )
    );
    if (state.rolesRoleId && guild.roles.cache.has(state.rolesRoleId)) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${ID}:jumpperm:${state.rolesRoleId}`)
            .setLabel("Voir/modifier ses permissions")
            .setStyle(ButtonStyle.Secondary)
        )
      );
    }
  } else if (meta.key === "logs") {
    if (can(member, "logs.manage")) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ID}:logcat`)
            .setPlaceholder("Configurer un salon manuellement — choisir une catégorie")
            .addOptions(
              Object.entries(LOG_CATEGORY_LABELS).map(([key, label]) =>
                new StringSelectMenuOptionBuilder().setLabel(label).setValue(key).setDefault(state.logsCategory === key)
              )
            )
        )
      );
      if (state.logsCategory && LOG_CATEGORY_LABELS[state.logsCategory]) {
        const channels = getAllLogChannels(guild.id);
        const select = new ChannelSelectMenuBuilder()
          .setCustomId(`${ID}:logchannel:${state.logsCategory}`)
          .setPlaceholder(`Salon pour ${LOG_CATEGORY_LABELS[state.logsCategory]}`)
          .addChannelTypes(ChannelType.GuildText)
          .setMinValues(0)
          .setMaxValues(1);
        if (channels[state.logsCategory]) select.setDefaultChannels(channels[state.logsCategory]);
        container.addActionRowComponents(new ActionRowBuilder().addComponents(select));
      }
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${ID}:logauto`)
            .setLabel("Créer les salons automatiquement")
            .setStyle(ButtonStyle.Success)
        )
      );
    }
  } else if (meta.key === "history") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:history:search`).setLabel("Rechercher").setStyle(ButtonStyle.Secondary)
      )
    );
  } else if (meta.key === "protection") {
    const config = automod.getConfig(guild.id);
    const linkConfig = antiLink.getConfig(guild.id);
    const mentionConfig = antiMention.getConfig(guild.id);
    const wordsConfig = badWords.getConfig(guild.id);
    const nextMode = linkConfig.mode === "all" ? "invite" : "all";
    const MENTION_STEPS = [3, 5, 8, 10, 15, 20];
    const nextMentionMax = MENTION_STEPS.find((n) => n > mentionConfig.maxMentions) || MENTION_STEPS[0];

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${ID}:automod:toggle`)
          .setLabel(config.enabled ? "Désactiver l'anti-spam" : "Activer l'anti-spam")
          .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`${ID}:antilink:toggle`)
          .setLabel(linkConfig.enabled ? "Désactiver l'anti-lien" : "Activer l'anti-lien")
          .setStyle(linkConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`${ID}:antimention:toggle`)
          .setLabel(mentionConfig.enabled ? "Désactiver l'anti-mass-mention" : "Activer l'anti-mass-mention")
          .setStyle(mentionConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`${ID}:badwords:toggle`)
          .setLabel(wordsConfig.enabled ? "Désactiver les mots interdits" : "Activer les mots interdits")
          .setStyle(wordsConfig.enabled ? ButtonStyle.Danger : ButtonStyle.Success)
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${ID}:antilink:mode`)
          .setLabel(`Mode anti-lien : ${linkConfig.mode === "all" ? "tous les liens" : "invitations"} (changer → ${nextMode === "all" ? "tous les liens" : "invitations"})`)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`${ID}:antimention:threshold`)
          .setLabel(`Seuil mentions : ${mentionConfig.maxMentions} (changer → ${nextMentionMax})`)
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(`${ID}:badwords:add`).setLabel("Ajouter un mot interdit").setStyle(ButtonStyle.Secondary)
      )
    );
    const words = badWords.getWords(guild.id);
    if (words.length) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ID}:badwords:del`)
            .setPlaceholder("Retirer un mot interdit")
            .addOptions(words.slice(0, 25).map((w) => new StringSelectMenuOptionBuilder().setLabel(w.slice(0, 100)).setValue(w)))
        )
      );
    }
    if (can(member, "protection.whitelist")) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder().setCustomId(`${ID}:wladd`).setPlaceholder("Ajouter à la whitelist anti-spam")
        ),
        new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder().setCustomId(`${ID}:wldel`).setPlaceholder("Retirer de la whitelist anti-spam")
        )
      );
    }
  } else if (meta.key === "guard") {
    const config = guardConfig.getConfig(guild.id);
    const nextPunishment = { timeout: "kick", kick: "ban", ban: "timeout" }[config.punishment];
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${ID}:guard:toggle`)
          .setLabel(config.enabled ? "Désactiver l'anti-nuke" : "Activer l'anti-nuke")
          .setStyle(config.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`${ID}:guard:punishment`)
          .setLabel(`Sanction : ${config.punishment} (changer → ${nextPunishment})`)
          .setStyle(ButtonStyle.Secondary)
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId(`${ID}:guardwladd`).setPlaceholder("Ajouter à la whitelist anti-nuke")
      ),
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId(`${ID}:guardwldel`).setPlaceholder("Retirer de la whitelist anti-nuke")
      )
    );
  } else if (meta.key === "welcome") {
    const config = welcomeStore.getConfig(guild.id);
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${ID}:welcomechannel`)
          .setPlaceholder("Envoyer le message de bienvenue à ce salon")
          .addChannelTypes(ChannelType.GuildText)
          .setMinValues(0)
          .setMaxValues(1)
          .setDefaultChannels(config.channelId ? [config.channelId] : [])
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${ID}:welcomedelete`)
          .setPlaceholder("Suppression automatique")
          .addOptions(
            WELCOME_DELETE_OPTIONS.map((opt) =>
              new StringSelectMenuOptionBuilder().setLabel(opt.label).setValue(String(opt.seconds)).setDefault(config.autoDeleteSeconds === opt.seconds)
            )
          )
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:welcomeadd`).setLabel("Ajouter un message").setStyle(ButtonStyle.Secondary)
      )
    );
    if (config.messages.length) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ID}:welcomedel`)
            .setPlaceholder("Retirer un message")
            .addOptions(
              config.messages.map((m, i) => new StringSelectMenuOptionBuilder().setLabel(`${i + 1}. ${m}`.slice(0, 100)).setValue(String(i)))
            )
        )
      );
    }
  } else if (meta.key === "access") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:access:sweep`).setLabel("Nettoyer les accès obsolètes").setStyle(ButtonStyle.Danger)
      )
    );
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
 * Résultats de recherche d'historique, formatés pour une réponse éphémère
 * (pas de mutation du panneau partagé : c'est une consultation personnelle).
 */
function formatHistoryResults(results) {
  if (!results.length) return "Aucune entrée ne correspond à cette recherche.";
  return results
    .map((e) => {
      const when = `<t:${Math.floor(new Date(e.createdAt).getTime() / 1000)}:f>`;
      return [
        `\`${e.action}\` — ${when}`,
        e.targetTag ? `Cible : **${e.targetTag}** (${e.targetId})` : null,
        `Modérateur : ${e.moderatorTag || e.moderatorId}`,
        e.reason ? `Raison : ${e.reason}` : null,
        `ID : \`${e.id}\``,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

/**
 * Traite toutes les interactions du panneau (identifiants en "cfg:"). Les
 * droits sont re-vérifiés à CHAQUE clic — le message reste visible dans le
 * salon après l'envoi, n'importe qui pourrait cliquer dessus.
 */
async function handleConfigInteraction(interaction) {
  const [, action, extra, extra2] = interaction.customId.split(":");
  const member = interaction.member;

  if (!hasAnyPanelAccess(member)) {
    return interaction.reply({ content: "Tu n'as pas accès à ce panneau.", flags: MessageFlags.Ephemeral });
  }

  const guild = interaction.guild;
  const guildId = guild.id;
  const isOwner = accessStore.isOwner(member.id);

  const goto = (section, state) => interaction.update(buildConfigPanel(guild, section, member, state));

  if (action === "nav") {
    return goto(interaction.values[0]);
  }

  if (action === "permrole") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    return goto("permissions", { permissionsRoleId: interaction.values[0] });
  }

  if (action === "permcat") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    return goto("permissions", { permissionsRoleId: extra, permissionsCategory: interaction.values[0] });
  }

  if (action === "permkeys") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    // extra = roleId, extra2 = catégorie affichée dans ce menu : on ne
    // remplace que les clés DE CETTE catégorie, les autres catégories
    // déjà accordées à ce rôle restent intactes.
    const categoryKeys = new Set(
      permCatalog
        .byCategory()
        .find((c) => c.category === extra2)
        ?.permissions.map((p) => p.key) || []
    );
    const current = permStore.getRoleGrants(guildId, extra).filter((k) => !categoryKeys.has(k));
    permStore.setRoleGrants(guildId, extra, [...current, ...interaction.values]);
    return goto("permissions", { permissionsRoleId: extra, permissionsCategory: extra2 });
  }

  if (action === "profilerole") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    return goto("profiles", { profilesRoleId: interaction.values[0] });
  }

  if (action === "profileapply") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const profile = getProfile(interaction.values[0]);
    if (!profile) return interaction.reply({ content: "Profil inconnu.", flags: MessageFlags.Ephemeral });
    // Octroi en masse ADDITIF : n'écrase pas ce qui était déjà accordé, un
    // profil est un point de départ, pas un remplacement (section 8).
    const current = new Set(permStore.getRoleGrants(guildId, extra));
    for (const key of profile.permissions) current.add(key);
    permStore.setRoleGrants(guildId, extra, [...current]);
    return goto("profiles", { profilesRoleId: extra });
  }

  if (action === "roleinfo") {
    if (!can(member, "panel.roles.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    return goto("roles", { rolesRoleId: interaction.values[0] });
  }

  if (action === "jumpperm") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    return goto("permissions", { permissionsRoleId: extra });
  }

  if (action === "logcat") {
    if (!can(member, "logs.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    return goto("logs", { logsCategory: interaction.values[0] });
  }

  if (action === "logchannel") {
    if (!can(member, "logs.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    setLogChannelId(guildId, extra, interaction.values[0] || null);
    return goto("logs", { logsCategory: extra });
  }

  if (action === "logauto") {
    if (!can(member, "logs.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const botPerm = checkBotPermission(guild, PermissionFlagsBits.ManageChannels, "ManageChannels");
    if (botPerm) return interaction.reply({ content: botPerm, flags: MessageFlags.Ephemeral });

    const { created } = await createLogChannelsAutomatically(guild);
    await interaction.reply({
      content: created.length
        ? `${created.length} salon(s) créé(s) : ${created.map((c) => `<#${c.channel.id}>`).join(", ")}.`
        : "Toutes les catégories ont déjà un salon configuré, rien à créer.",
      flags: MessageFlags.Ephemeral,
    });
    return goto("logs");
  }

  if (action === "history" && extra === "search") {
    if (!can(member, "logs.view")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    if (interaction.isModalSubmit()) return handleHistorySearchModal(interaction);
    const modal = new ModalBuilder().setCustomId(`${ID}:history:search`).setTitle("Rechercher dans l'historique");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("target").setLabel("Cible (ID ou mention)").setStyle(TextInputStyle.Short).setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("moderator").setLabel("Modérateur (ID ou mention)").setStyle(TextInputStyle.Short).setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("action")
          .setLabel("Type (ban, kick, timeout, clear...)")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("id").setLabel("ID d'entrée précis").setStyle(TextInputStyle.Short).setRequired(false)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "automod" && extra === "toggle") {
    if (!can(member, "protection.automod")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    automod.setEnabled(guildId, !automod.getConfig(guildId).enabled);
    return goto("protection");
  }

  if (action === "wladd" || action === "wldel") {
    if (!can(member, "protection.whitelist")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const userId = interaction.values[0];
    if (action === "wladd") automod.addToWhitelist(guildId, "users", userId);
    else automod.removeFromWhitelist(guildId, "users", userId);
    return goto("protection");
  }

  if (action === "antilink" && extra === "toggle") {
    if (!can(member, "protection.automod")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    antiLink.setEnabled(guildId, !antiLink.getConfig(guildId).enabled);
    return goto("protection");
  }

  if (action === "antilink" && extra === "mode") {
    if (!can(member, "protection.automod")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const next = antiLink.getConfig(guildId).mode === "all" ? "invite" : "all";
    antiLink.setMode(guildId, next);
    return goto("protection");
  }

  if (action === "antimention" && extra === "toggle") {
    if (!can(member, "protection.automod")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    antiMention.setEnabled(guildId, !antiMention.getConfig(guildId).enabled);
    return goto("protection");
  }

  if (action === "antimention" && extra === "threshold") {
    if (!can(member, "protection.automod")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const steps = [3, 5, 8, 10, 15, 20];
    const current = antiMention.getConfig(guildId).maxMentions;
    const next = steps.find((n) => n > current) || steps[0];
    antiMention.setMaxMentions(guildId, next);
    return goto("protection");
  }

  if (action === "badwords" && extra === "toggle") {
    if (!can(member, "protection.automod")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    badWords.setEnabled(guildId, !badWords.getConfig(guildId).enabled);
    return goto("protection");
  }

  if (action === "badwords" && extra === "del") {
    if (!can(member, "protection.automod")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    badWords.removeWord(guildId, interaction.values[0]);
    return goto("protection");
  }

  if (action === "badwords" && extra === "add") {
    if (!can(member, "protection.automod")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    if (interaction.isModalSubmit()) {
      const word = interaction.fields.getTextInputValue("value").trim();
      if (!word) return interaction.reply({ content: "Mot vide, rien n'a été ajouté.", flags: MessageFlags.Ephemeral });
      const added = badWords.addWord(guildId, word);
      await interaction.reply({
        content: added ? `\`${word}\` ajouté à la liste.` : "Ce mot y était déjà.",
        flags: MessageFlags.Ephemeral,
      });
      return interaction.message?.edit(buildConfigPanel(guild, "protection", member)).catch(() => {});
    }
    const modal = new ModalBuilder().setCustomId(`${ID}:badwords:add`).setTitle("Ajouter un mot interdit");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("value").setLabel("Mot à interdire").setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "guard" && extra === "toggle") {
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    guardConfig.setEnabled(guildId, !guardConfig.getConfig(guildId).enabled);
    return goto("guard");
  }

  if (action === "guard" && extra === "punishment") {
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const next = { timeout: "kick", kick: "ban", ban: "timeout" }[guardConfig.getConfig(guildId).punishment];
    guardConfig.setPunishment(guildId, next);
    return goto("guard");
  }

  if (action === "guardwladd" || action === "guardwldel") {
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const userId = interaction.values[0];
    if (action === "guardwladd") guardWhitelist.add(guildId, "users", userId);
    else guardWhitelist.remove(guildId, "users", userId);
    return goto("guard");
  }

  if (action === "welcomechannel") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    welcomeStore.setChannel(guildId, interaction.values[0] || null);
    return goto("welcome");
  }

  if (action === "welcomedelete") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    welcomeStore.setAutoDelete(guildId, parseInt(interaction.values[0], 10) || 0);
    return goto("welcome");
  }

  if (action === "welcomedel") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    welcomeStore.removeMessage(guildId, parseInt(interaction.values[0], 10));
    return goto("welcome");
  }

  if (action === "welcomeadd") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    if (interaction.isModalSubmit()) {
      const text = interaction.fields.getTextInputValue("value").trim();
      if (!text) return interaction.reply({ content: "Message vide, rien n'a été ajouté.", flags: MessageFlags.Ephemeral });
      welcomeStore.addMessage(guildId, text);
      await interaction.reply({ content: "Message de bienvenue ajouté.", flags: MessageFlags.Ephemeral });
      return interaction.message?.edit(buildConfigPanel(guild, "welcome", member)).catch(() => {});
    }
    const modal = new ModalBuilder().setCustomId(`${ID}:welcomeadd`).setTitle("Ajouter un message de bienvenue");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("value")
          .setLabel("Message (tiré au hasard à l'arrivée)")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "access" && extra === "sweep") {
    if (!can(member, "sys")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const revoked = sweepGuild(interaction.client, guild);
    await interaction.reply({
      content: revoked.length ? `${revoked.length} accès obsolète(s) révoqué(s).` : "Rien à nettoyer, tout est à jour.",
      flags: MessageFlags.Ephemeral,
    });
    return goto("access");
  }

  if (action === "add" || action === "del") {
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
    return goto(SECTION_OF_SCOPE[extra] || "home");
  }

  if (action === "prefix") {
    if (interaction.isModalSubmit()) {
      const value = interaction.fields.getTextInputValue("value").trim();
      if (!value) {
        return interaction.reply({ content: "Préfixe vide, rien n'a été changé.", flags: MessageFlags.Ephemeral });
      }
      setPrefix(guildId, extra, value);
      await interaction.reply({
        content: `**${PREFIX_FIELDS[extra].label}** réglé sur \`${value}\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return interaction.message?.edit(buildConfigPanel(guild, "prefixes", member)).catch(() => {});
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

/** Traite la soumission de la modale de recherche d'historique (voir index.js). */
async function handleHistorySearchModal(interaction) {
  if (!can(interaction.member, "logs.view")) {
    return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
  }
  const targetRaw = interaction.fields.getTextInputValue("target").trim();
  const moderatorRaw = interaction.fields.getTextInputValue("moderator").trim();
  const actionRaw = interaction.fields.getTextInputValue("action").trim();
  const idRaw = interaction.fields.getTextInputValue("id").trim();

  const extractId = (s) => s.match(/\d{15,25}/)?.[0] || null;

  const results = historyStore.search(interaction.guild.id, {
    targetId: extractId(targetRaw) || undefined,
    moderatorId: extractId(moderatorRaw) || undefined,
    action: actionRaw || undefined,
    id: idRaw || undefined,
    limit: 10,
  });

  await interaction.reply({
    embeds: [{ title: "Résultats de recherche", description: formatHistoryResults(results).slice(0, 4000) }],
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = { buildConfigPanel, handleConfigInteraction, handleHistorySearchModal, hasAnyPanelAccess, ID, SECTIONS };
