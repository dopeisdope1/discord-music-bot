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
const { commandsForKeys, nonCommandGrants } = require("./permsCommands");
const { sweepGuild } = require("./permissions/cleanup");
const { checkBotPermission } = require("./moderation/actions");
const { getAllLogChannels, setLogChannelId, CATEGORY_LABELS: LOG_CATEGORY_LABELS } = require("./modLogStore");
const { LOG_CHANNEL_NAMES, createLogChannelsAutomatically, deleteLogChannelsAutomatically } = require("./logChannels");
const historyStore = require("./moderationHistoryStore");
const leaveStore = require("./leaveStore");
const autoroleStore = require("./autoroleStore");
const verificationStore = require("./verificationStore");
const automod = require("./automod/antiSpam");
const antiLink = require("./automod/antiLink");
const antiMention = require("./automod/antiMention");
const badWords = require("./automod/badWords");
const welcomeStore = require("./welcomeStore");
const guardConfig = require("./guard/config");
const guardWhitelist = require("./guard/whitelist");
const { ALL_GUARDS } = require("./guard/definitions");
const muteStore = require("./muteStore");
const ticketStore = require("./ticketStore");
const voiceChannels = require("./voiceChannels");
const voiceHubSetup = require("./voiceHubSetup");
const { roleAdmin } = require("./serverAdminCommands");
const { parseDuration } = require("./moderationCommands");
const { computeSecurityScan } = require("./securityScan");
const { computeStatus, formatUptime } = require("./statusDiagnostic");
const { FORMS, setFormState, buildFormCard } = require("./commandForms");
const { fakeMessage } = require("./fakeMessage");
const { utilityHandlers } = require("./utilityCommands");
const giveawayStore = require("./giveawayStore");
const { endGiveaway, rerollGiveaway } = require("./giveaways");
const { handleEmbedButton } = require("./serverExtra");

// Noms donnés aux salons créés par le bouton "Créer les salons
// automatiquement" (rubrique Logs) — ASCII simple, pas d'accent, pour éviter
// tout souci d'encodage sur un nom de salon.
// Préréglages pour la rubrique Bienvenue — 0 = jamais supprimé.
const WELCOME_DELETE_OPTIONS = [
  { label: "10 secondes", seconds: 10 },
  { label: "30 secondes", seconds: 30 },
  { label: "1 minute", seconds: 60 },
  { label: "5 minutes", seconds: 300 },
  { label: "Jamais", seconds: 0 },
];

// Tous les identifiants d'interaction du panneau commencent par "cfg:", ce
// qui permet à index.js de les router sans les énumérer un par un.
const ID = "cfg";

// Droits qui donnent accès au centre de modération (fiche membre) : au moins
// UNE action doit être possible, ou au moins la consultation de
// l'historique — chaque bouton de la fiche reste ensuite gated séparément
// par son propre droit (voir le rendu de "modCenter").
const MOD_CENTER_PERMS = [
  "moderation.warn",
  "moderation.timeout",
  "moderation.kick",
  "moderation.ban",
  "members.role",
  "logs.view",
];
const canOpenModCenter = (member) => MOD_CENTER_PERMS.some((key) => can(member, key));

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
  {
    key: "permissions",
    label: "Rôles et permissions",
    description: "Informations d'un rôle et permissions du bot qu'il accorde",
    // Consultable avec l'un OU l'autre droit ; seul panel.permissions.manage
    // fait apparaître les menus qui modifient.
    visible: (member) => can(member, "panel.permissions.manage") || can(member, "panel.roles.manage"),
  },
  {
    key: "logs",
    label: "Logs",
    description: "Salon de logs par catégorie (modération/membres/serveur/bots)",
    visible: (member) => can(member, "logs.view") || can(member, "logs.manage"),
  },
  {
    key: "modCenter",
    label: "Recherche de membre",
    description: "Fiche membre : sanctions, rôles, actions rapides",
    visible: (member) => canOpenModCenter(member),
  },
  { key: "history", label: "Historique", description: "Rechercher dans l'historique de modération", permission: "logs.view" },
  {
    key: "securityOverview",
    label: "Vue d'ensemble",
    description: "État global : anti-spam, anti-nuke, mute, logs, permissions dangereuses",
    visible: (member) => can(member, "protection.automod") || can(member, "protection.guard.manage"),
  },
  { key: "protection", label: "Protection", description: "Anti-spam et whitelist", permission: "protection.automod" },
  { key: "guard", label: "Anti-nuke", description: "Détection de rafales destructrices et sanction automatique", permission: "protection.guard.manage" },
  { key: "welcome", label: "Bienvenue", description: "Message de bienvenue à l'arrivée d'un membre", permission: "server.welcome.manage" },
  { key: "leave", label: "Départ", description: "Message envoyé quand un membre quitte le serveur", permission: "server.welcome.manage" },
  { key: "autorole", label: "Rôles automatiques", description: "Rôles donnés automatiquement à l'arrivée", permission: "members.autorole.manage" },
  { key: "verification", label: "Vérification", description: "Rôle et salon du bouton \"Se vérifier\"", permission: "members.verification.manage" },
  { key: "mute", label: "Mute", description: "Rôle utilisé par &mute/&tempmute/&cmute", permission: "protection.automod" },
  { key: "tickets", label: "Tickets", description: "Rôle staff des tickets (voir &ticket setup)", permission: "server.tickets.manage" },
  { key: "voice", label: "Vocaux", description: "Salon générateur de vocaux temporaires (voir &voicehub)", permission: "server.voice.manage" },
  { key: "giveaways", label: "Giveaways", description: "Giveaways en cours : démarrer, terminer, reroll", permission: "server.giveaways.manage" },
  { key: "embedBuilder", label: "Constructeur d'embed", description: "Composer et envoyer un embed dans un salon", permission: "server.channels.manage" },
  { key: "polls", label: "Sondages", description: "Créer un sondage (2 à 5 options)", permission: "server.polls.manage" },
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

// Rubriques regroupées par FAMILLE (centre de contrôle, refonte du panel) :
// le menu principal ne montre que les familles, un second menu n'apparaît
// que pour choisir une rubrique dans la famille ouverte. Onze familles
// cibles au total (Accueil/Sécurité/Modération/Serveur/Communauté/Support/
// Communication/Musique/Monitoring/Sauvegardes/Bot) — celles encore vides
// aujourd'hui (Musique, Sauvegardes) n'apparaissent pas encore dans ce
// tableau : elles arrivent avec le module qui leur donne un vrai contenu
// plutôt que d'exposer un onglet qui ne fait rien.
//
// Les écrans eux-mêmes ne sont PAS fusionnés — chacun garde ses contrôles et
// ses avertissements. "Rang sys" et "Ban de masse" voisinent dans la même
// famille sans jamais partager le même écran : l'un donne accès à tout le bot,
// l'autre bannit le serveur entier, et un mauvais clic ne pardonne pas.
const FAMILIES = [
  { key: "accueil", label: "Accueil", description: "Dashboard et vue d'ensemble", sections: ["home"] },
  { key: "securite", label: "Sécurité", description: "Anti-spam, anti-nuke, mute", sections: ["securityOverview", "protection", "guard", "mute"] },
  { key: "moderation", label: "Modération", description: "Fiche membre, sanctions, historique", sections: ["modCenter", "history"] },
  {
    key: "serveur",
    label: "Serveur",
    description: "Rôles, permissions, rôles automatiques, vérification",
    sections: ["permissions", "autorole", "verification"],
  },
  { key: "communaute", label: "Communauté", description: "Bienvenue, départ, vocaux temporaires, giveaways", sections: ["welcome", "leave", "voice", "giveaways"] },
  { key: "support", label: "Support", description: "Tickets", sections: ["tickets"] },
  { key: "communication", label: "Communication", description: "Embed, sondages", sections: ["embedBuilder", "polls"] },
  { key: "monitoring", label: "Monitoring", description: "Salons de logs", sections: ["logs"] },
  {
    key: "bot",
    label: "Bot",
    description: "Préfixes, accès au panel, rang sys, ban de masse, dispenses",
    sections: ["prefixes", "access", "sys", "banall", "moderation"],
  },
];

const familyOf = (sectionKey) => FAMILIES.find((f) => f.sections.includes(sectionKey)) || FAMILIES[0];

/** Rubriques d'une famille auxquelles la personne a réellement droit. */
function familySections(family, member, isOwner) {
  const visibles = sectionsFor(member, isOwner);
  return family.sections.map((key) => visibles.find((s) => s.key === key)).filter(Boolean);
}

function buildNav(current, member, isOwner) {
  const famille = familyOf(current);
  const disponibles = FAMILIES.filter((f) => familySections(f, member, isOwner).length);
  return new StringSelectMenuBuilder()
    .setCustomId(`${ID}:nav`)
    .setPlaceholder("Choisis une famille de réglages")
    .addOptions(
      disponibles.map((f) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(f.label)
          .setDescription(f.description.slice(0, 100))
          .setValue(f.key)
          .setDefault(f.key === famille.key)
      )
    );
}

/**
 * Second menu, affiché seulement quand la famille ouverte contient plus d'une
 * rubrique visible : sinon il n'offrirait aucun choix.
 */
function buildSubNav(current, member, isOwner) {
  const rubriques = familySections(familyOf(current), member, isOwner);
  if (rubriques.length < 2) return null;
  return new StringSelectMenuBuilder()
    .setCustomId(`${ID}:subnav`)
    .setPlaceholder("Choisis une rubrique")
    .addOptions(
      rubriques.map((s) =>
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

// Le corps d'une rubrique dit UNIQUEMENT ce qui est configuré en ce moment —
// une ligne "> **Réglage** : valeur" par réglage. Aucune explication de
// fonctionnement : le panel est un poste de commande, pas une documentation.
// Le "pourquoi" et le "comment" vivent dans le README et dans &help, où on
// peut les lire sans faire défiler un écran de contrôles.
function sectionBody(section, guild, member, state) {
  const guildId = guild.id;
  const prefixes = getPrefixes(guildId);
  const owners = accessStore.ownerIds();

  if (section === "prefixes") {
    return [
      `> **Préfixe musique** : \`${prefixes.main}\``,
      `> **Préfixe des commandes** : \`${prefixes.musicMod}\``,
    ].join("\n");
  }

  if (section === "moderation") {
    return [
      `> **Dispensés du quota de nettoyage** : ${mentions(accessStore.list("clear"))}`,
      `> **Accès legacy aux commandes de salon** : ${mentions(accessStore.list("salon"))}`,
    ].join("\n");
  }

  // "Permissions" et "Rôles" étaient deux rubriques qui commençaient toutes
  // deux par "choisis un rôle" — au point que la seconde avait un bouton pour
  // sauter vers la première. Fusionnées : un seul sélecteur de rôle, puis
  // TOUT ce qui concerne ce rôle, ses informations comme ses permissions.
  if (section === "permissions") {
    const roleId = state.permissionsRoleId;
    if (!roleId) return "> *Choisis un rôle dans le menu ci-dessous.*";
    const role = guild.roles.cache.get(roleId);
    if (!role) return "> *Ce rôle n'existe plus sur le serveur.*";

    // Seules les permissions Discord qui donnent un vrai pouvoir : lister les
    // 40 autres noierait celles qui comptent.
    const notables = role.permissions
      .toArray()
      .filter((perm) =>
        ["Administrator", "BanMembers", "KickMembers", "ModerateMembers", "ManageRoles", "ManageChannels", "ManageGuild", "ManageMessages"].includes(perm)
      );
    const granted = permStore.getRoleGrants(guildId, roleId);
    // Le catalogue complet n'est pas recopié : le menu déroulant plus bas les
    // liste déjà toutes, en cochant celles qui sont accordées.
    const parCategorie = permCatalog
      .byCategory()
      .map((group) => {
        const n = group.permissions.filter((perm) => granted.includes(perm.key)).length;
        return n ? `> **${group.label}** : ${n}` : null;
      })
      .filter(Boolean);

    const lines = [
      `> **Rôle** : ${role.toString()} — \`${role.id}\``,
      `> **Membres** : ${role.members.size} · **position** : ${role.position}/${guild.roles.cache.size} · **couleur** : ${role.hexColor}`,
      `> **Exclusif** : ${permStore.isRoleExclusive(guildId, roleId) ? "oui" : "non"}`,
      `> **Permissions Discord notables** : ${notables.length ? notables.join(", ") : "*aucune*"}`,
      `> **Permissions du bot accordées** : ${granted.length}`,
      ...parCategorie,
    ];

    // Le nombre par catégorie ne dit pas QUELLES commandes ça débloque —
    // bouton "Voir les commandes débloquées" plus bas pour l'afficher en clair.
    if (state.permissionsShowCommands) {
      const commands = commandsForKeys(granted);
      lines.push("", `**Commandes débloquées par ce rôle (${commands.length})** :`);
      lines.push(commands.length ? commands.map((c) => `\`${c}\``).join(", ") : "*aucune*");
      // Une clé accordée peut donner accès à une rubrique du panel plutôt
      // qu'à une commande tapée — sans cette section, "0 commande" donnait
      // l'impression fausse que rien n'était accordé du tout.
      const autres = nonCommandGrants(granted);
      if (autres.length) {
        lines.push("", `**Accès sans commande dédiée (${autres.length})** :`);
        lines.push(autres.map((l) => `\`${l}\``).join(", "));
      }
    }

    return lines.join("\n");
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
      // Seules exceptions à la règle "pas de prose" : dire qu'on est en lecture
      // seule, et nommer la catégorie en cours d'édition. Sans elles, les
      // contrôles affichés en dessous n'ont pas de sens.
      manage ? null : "> *Lecture seule — le droit `logs.manage` est requis pour modifier.*",
      manage && catLabel ? `> *Catégorie en cours : **${catLabel}** — choisis son salon ci-dessous.*` : null,
    ]
      .filter((l) => l !== null)
      .join("\n");
  }

  if (section === "modCenter") {
    const targetId = state.modTargetId;
    if (!targetId) return "> *Choisis un membre dans le menu ci-dessous.*";
    const targetMember = guild.members.cache.get(targetId);
    if (!targetMember) return "> *Ce membre n'a pas pu être chargé (a-t-il quitté le serveur ?) — relance une recherche.*";

    const entries = historyStore.search(guildId, { targetId, limit: 0 });
    const roleNames = [...targetMember.roles.cache.values()].filter((r) => r.id !== guildId).map((r) => r.toString());
    const lines = [
      `> **Membre** : ${targetMember.toString()} — \`${targetMember.id}\``,
      `> **Arrivé le** : ${targetMember.joinedTimestamp ? `<t:${Math.floor(targetMember.joinedTimestamp / 1000)}:D>` : "*inconnu*"}`,
      `> **Compte créé le** : <t:${Math.floor(targetMember.user.createdTimestamp / 1000)}:D>`,
      `> **Rôles (${roleNames.length})** : ${roleNames.length ? roleNames.slice(0, 8).join(", ") + (roleNames.length > 8 ? `, +${roleNames.length - 8}` : "") : "*aucun*"}`,
      `> **Sanctions enregistrées** : ${entries.length}`,
    ];
    const recentEntries = entries.slice(0, 3);
    if (recentEntries.length) {
      lines.push("", "**Dernières sanctions :**");
      for (const e of recentEntries) {
        const when = `<t:${Math.floor(new Date(e.createdAt).getTime() / 1000)}:R>`;
        lines.push(`> \`${e.action}\` — ${e.reason || "*sans raison*"} — ${when}`);
      }
    }
    return lines.join("\n");
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
    ].join("\n");
  }

  if (section === "securityOverview") {
    const { critical, warnings, ok } = computeSecurityScan(guild);
    const emoji = critical.length ? "🔴" : warnings.length ? "🟠" : "🟢";
    const lines = [`${emoji} **${ok.length}** OK · **${warnings.length}** avertissement(s) · **${critical.length}** critique(s)`];
    if (critical.length) lines.push("", "**🔴 Critique :**", ...critical.map((l) => `> ${l}`));
    if (warnings.length) lines.push("", "**🟠 Avertissements :**", ...warnings.map((l) => `> ${l}`));
    if (!critical.length && !warnings.length) lines.push("", "*Tout est en ordre — voir le détail dans Protection/Anti-nuke/Mute.*");
    return lines.join("\n");
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
    ].join("\n");
  }

  if (section === "guard") {
    const config = guardConfig.getConfig(guildId);
    const whitelist = guardWhitelist.getWhitelist(guildId);
    // Juste la clé (pas le libellé complet) + le seuil : la description de
    // chaque guard vit dans &help, pas ici — même règle "montre, n'explique
    // pas" que le reste du panel.
    const guardLines = ALL_GUARDS.map((d) => {
      const rule = d.threshold ? `${d.threshold.count}/${d.threshold.windowMs / 1000}s` : "immédiat";
      const on = guardConfig.isGuardEnabled(guildId, d.key);
      return `> ${on ? "🟢" : "🔴"} \`${d.key}\` (${rule})`;
    });
    return [
      `> **Anti-nuke** (interrupteur général) : ${config.enabled ? "activé" : "désactivé"}`,
      `> **Sanction** : ${config.punishment}${config.punishment === "timeout" ? ` (${config.punishmentDurationMs / 60000} min)` : ""}`,
      `> **Ping** : ${config.pingRoleId ? `<@&${config.pingRoleId}>` : "*aucun*"}`,
      `> **Compte minimum** : ${config.creationLimitMs ? `${Math.round(config.creationLimitMs / 86400000)}j` : "*désactivé*"}`,
      `> **Verrouillage auto si plafond atteint** : ${config.autoLockdownOnCap ? "activé" : "désactivé"}`,
      `> **Whitelist** : ${mentions([...whitelist.users, ...whitelist.roles])}`,
      "",
      ...guardLines,
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

  if (section === "leave") {
    const config = leaveStore.getConfig(guildId);
    const lines = config.messages.length
      ? config.messages.map((m, i) => `${i + 1}. *${m}*`).join("\n")
      : "*Aucun message configuré — le message de départ reste désactivé tant qu'il n'y en a pas au moins un.*";
    return [
      `> **Salon** : ${config.channelId ? `<#${config.channelId}>` : "*aucun — désactivé*"}`,
      `> **Suppression auto** : ${config.autoDeleteSeconds ? `${config.autoDeleteSeconds} secondes` : "jamais"}`,
      "",
      "**Messages** (un est tiré au hasard à chaque départ, \"{user}\" = pseudo de la personne) :",
      lines,
    ].join("\n");
  }

  if (section === "autorole") {
    const roles = autoroleStore.getRoleIds(guildId).map((id) => guild.roles.cache.get(id)).filter(Boolean);
    return [
      "**Rôles donnés automatiquement à chaque arrivée :**",
      roles.length ? roles.map((r) => `> ${r}`).join("\n") : "*Aucun rôle configuré.*",
    ].join("\n");
  }

  if (section === "verification") {
    const config = verificationStore.getConfig(guildId);
    const role = config.roleId && guild.roles.cache.get(config.roleId);
    return [
      `> **Rôle donné** : ${role ? role : "*aucun — non configuré*"}`,
      `> **Salon du bouton** : ${config.channelId ? `<#${config.channelId}>` : "*pas encore posté*"}`,
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
    ].join("\n");
  }

  if (section === "sys") {
    return [
      `> **Rang sys** : ${mentions(accessStore.list("sys"))}`,
    ].join("\n");
  }

  if (section === "mute") {
    const roleId = muteStore.getMuteRoleId(guildId);
    return [
      `> **Rôle de mute** : ${roleId && guild.roles.cache.has(roleId) ? `<@&${roleId}>` : "*aucun — non configuré*"}`,
    ].join("\n");
  }

  if (section === "tickets") {
    const config = ticketStore.getConfig(guildId);
    return [
      `> **Rôle staff** : ${config.staffRoleId && guild.roles.cache.has(config.staffRoleId) ? `<@&${config.staffRoleId}>` : "*aucun*"}`,
    ].join("\n");
  }

  if (section === "voice") {
    const hubId = voiceChannels.getHub(guildId);
    const hubConfig = voiceChannels.getHubConfig(guildId);
    const spawnOk = hubConfig.spawnCategoryId && guild.channels.cache.has(hubConfig.spawnCategoryId);
    const panelOk = hubConfig.panelChannelId && guild.channels.cache.has(hubConfig.panelChannelId);
    return [
      `> **Salon générateur** : ${hubId && guild.channels.cache.has(hubId) ? `<#${hubId}>` : "*aucun — désactivé*"}`,
      `> **Catégorie des salons créés** : ${spawnOk ? `<#${hubConfig.spawnCategoryId}>` : "*par défaut, même catégorie que le générateur*"}`,
      `> **Salon-panneau partagé** : ${panelOk ? `<#${hubConfig.panelChannelId}>` : "*aucun — le bouton \"Gérer mon salon\" n'apparaît pas*"}`,
      `> **Modèle de nom** : \`${hubConfig.voiceNameTemplate}\``,
      "",
      "Un seul panneau à boutons, partagé par tout le monde : il agit sur le salon vocal où la personne qui clique est connectée. " +
        "Fini le salon texte compagnon créé puis détruit à chaque salon vocal.",
      "",
      hubId && guild.channels.cache.has(hubId)
        ? "Configuré manuellement ou via \"Créer la configuration\" — le bouton ci-dessous ne recrée rien tant que c'est actif."
        : "\"Créer la configuration\" crée en un clic les deux catégories, le salon générateur et le salon-panneau.",
    ].join("\n");
  }

  if (section === "giveaways") {
    const active = giveawayStore
      .listForGuild(guildId)
      .filter((g) => !g.ended)
      .sort((a, b) => a.endsAt - b.endsAt);
    if (!active.length) return "> *Aucun giveaway en cours.*";
    const lines = active.slice(0, 5).map((g) => {
      const when = `<t:${Math.floor(g.endsAt / 1000)}:R>`;
      const gagnants = (g.winnersCount || 1) > 1 ? ` — ${g.winnersCount} gagnants` : "";
      return `> **${g.prize}** — <#${g.channelId}> — se termine ${when} — ${g.participants.length} participant(s)${gagnants}`;
    });
    return ["**Giveaways en cours :**", ...lines].join("\n");
  }

  if (section === "embedBuilder") {
    return "> *Aucun réglage — le bouton ci-dessous ouvre le même constructeur d'embed que `&embed`.*";
  }

  if (section === "polls") {
    return "> *Sondages en mémoire, perdus au redémarrage du bot — le bouton ci-dessous ouvre le même formulaire que `&poll`.*";
  }

  if (section === "banall") {
    return [
      `> **Autorisés** : ${mentions(accessStore.list("banall"))}`,
      // Exception assumée à la règle "pas de prose" : c'est le seul écran du
      // panel dont un mauvais clic bannit le serveur entier.
      "> ⚠️ *`banall` bannit tout le serveur d'un coup. Le propriétaire y a toujours droit sans figurer ici.*",
    ].join("\n");
  }

  if (section === "home") {
    const lines = [];

    // Sécurité — même détection que `&security scan`, sur le cache déjà en
    // mémoire (pas de fetch ici, voir le commentaire dans securityScan.js) :
    // un coup d'œil instantané, pas un audit complet.
    if (can(member, "protection.automod") || can(member, "protection.guard.manage")) {
      const { critical, warnings } = computeSecurityScan(guild);
      const emoji = critical.length ? "🔴" : warnings.length ? "🟠" : "🟢";
      lines.push(`**${emoji} Sécurité**`);
      if (!critical.length && !warnings.length) {
        lines.push("> Aucune alerte — tout est en ordre.");
      } else {
        for (const l of critical) lines.push(`> 🔴 ${l}`);
        for (const l of warnings) lines.push(`> 🟠 ${l}`);
      }
      lines.push("");
    }

    // Serveur — compteurs déjà en cache, aucune requête supplémentaire.
    const inVoice = guild.voiceStates.cache.filter((v) => v.channelId).size;
    lines.push(
      "**👥 Serveur**",
      `> **Membres** : ${guild.memberCount.toLocaleString("fr-FR")} · **rôles** : ${guild.roles.cache.size} · **salons** : ${guild.channels.cache.size} · **en vocal** : ${inVoice}`,
      ""
    );

    // Activité récente — mêmes entrées que la rubrique Historique.
    if (can(member, "logs.view")) {
      const recent = historyStore.search(guildId, { limit: 5 });
      lines.push("**📋 Activité récente**");
      if (!recent.length) {
        lines.push("> *Aucune entrée pour l'instant.*");
      } else {
        for (const e of recent) {
          const when = `<t:${Math.floor(new Date(e.createdAt).getTime() / 1000)}:R>`;
          lines.push(`> \`${e.action}\` ${e.targetTag ? `**${e.targetTag}**` : ""} — par ${e.moderatorTag || e.moderatorId} — ${when}`);
        }
      }
      lines.push("");
    }

    // Bot — réservé au rang sys, mêmes infos que &status.
    if (accessStore.isAllowed("sys", member.id)) {
      const info = computeStatus(guild.client);
      lines.push(
        "**⚙️ Bot**",
        `> **Uptime** : ${formatUptime(info.uptimeMs)} · **latence** : ${info.ping}ms · **serveurs** : ${info.guildCount}`
      );
    }

    return lines.join("\n").trim() || "*Aucune information à afficher.*";
  }

  return [
    `> **Préfixe musique** : \`${prefixes.main}\``,
    `> **Préfixe des commandes** : \`${prefixes.musicMod}\``,
    `> **Propriétaire(s)** : ${mentions(owners)}`,
    `> **Rang sys** : ${mentions(accessStore.list("sys"))}`,
    `> **Rôles avec des permissions accordées** : ${permStore.listRoleGrants(guildId).length}`,
  ].join("\n");
}

/**
 * Adapte une interaction en objet "message" minimal pour réutiliser
 * TEL QUEL utils/serverAdminCommands.js::roleAdmin (create/delete déjà
 * testés, avec confirmation et journalisation) plutôt que réimplémenter la
 * création/suppression de rôle depuis le panel.
 */
function messageFromInteraction(interaction) {
  return {
    member: interaction.member,
    guild: interaction.guild,
    channel: interaction.channel,
    author: interaction.user,
    mentions: { roles: { first: () => null } },
    reply: (payload) => interaction.reply(payload),
  };
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
 * @param {{ permissionsRoleId?: string, rolesRoleId?: string }} [state]
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
  const subNav = buildSubNav(meta.key, member, isOwner);
  if (subNav) container.addActionRowComponents(new ActionRowBuilder().addComponents(subNav));

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
    const peutModifier = can(member, "panel.permissions.manage");
    // Trois étapes (rôle → catégorie → clés) plutôt qu'un unique menu avec
    // toutes les clés : Discord plafonne un menu à 25 options, et le
    // catalogue (utils/permissions/catalog.js) a vocation à grandir —
    // chaque catégorie reste largement sous la limite, indéfiniment.
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId(`${ID}:permrole`).setPlaceholder("Choisir un rôle à configurer")
      )
    );
    if (peutModifier) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${ID}:rolecreate`).setLabel("Créer un rôle").setStyle(ButtonStyle.Success)
        )
      );
    }
    if (state.permissionsRoleId && guild.roles.cache.has(state.permissionsRoleId)) {
      // Bascules encodées dans le customId lui-même (pas d'état côté
      // serveur entre deux interactions) : le libellé/l'action reflètent ce
      // que CE rendu affiche déjà, donc un clic fait toujours l'inverse.
      const exclusif = permStore.isRoleExclusive(guild.id, state.permissionsRoleId);
      const boutons = [
        state.permissionsShowCommands
          ? new ButtonBuilder()
              .setCustomId(`${ID}:permhidecmds:${state.permissionsRoleId}`)
              .setLabel("Masquer les commandes débloquées")
              .setStyle(ButtonStyle.Secondary)
          : new ButtonBuilder()
              .setCustomId(`${ID}:permshowcmds:${state.permissionsRoleId}`)
              .setLabel("Voir les commandes débloquées")
              .setStyle(ButtonStyle.Secondary),
      ];
      if (can(member, "server.members.list")) {
        boutons.push(
          new ButtonBuilder().setCustomId(`${ID}:rolemembers:${state.permissionsRoleId}`).setLabel("Voir les membres").setStyle(ButtonStyle.Secondary)
        );
      }
      if (peutModifier) {
        boutons.push(
          exclusif
            ? new ButtonBuilder()
                .setCustomId(`${ID}:roleexclusiveoff:${state.permissionsRoleId}`)
                .setLabel("Retirer de l'exclusif")
                .setStyle(ButtonStyle.Secondary)
            : new ButtonBuilder()
                .setCustomId(`${ID}:roleexclusive:${state.permissionsRoleId}`)
                .setLabel("Ajouter à l'exclusif")
                .setStyle(ButtonStyle.Secondary)
        );
        boutons.push(
          new ButtonBuilder().setCustomId(`${ID}:roledelete:${state.permissionsRoleId}`).setLabel("Supprimer ce rôle").setStyle(ButtonStyle.Danger)
        );
      }
      container.addActionRowComponents(new ActionRowBuilder().addComponents(...boutons));
    }
    if (peutModifier && state.permissionsRoleId && guild.roles.cache.has(state.permissionsRoleId)) {
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
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`${ID}:logdelete`)
            .setLabel("Supprimer les salons de logs")
            .setStyle(ButtonStyle.Danger)
        )
      );
    }
  } else if (meta.key === "modCenter") {
    const targetSelect = new UserSelectMenuBuilder().setCustomId(`${ID}:modtarget`).setPlaceholder("Rechercher un membre").setMinValues(0).setMaxValues(1);
    if (state.modTargetId) targetSelect.setDefaultUsers([state.modTargetId]);
    container.addActionRowComponents(new ActionRowBuilder().addComponents(targetSelect));

    const targetMember = state.modTargetId && guild.members.cache.get(state.modTargetId);
    if (targetMember) {
      // Chaque bouton ouvre la MÊME carte de formulaire que la commande tapée
      // à la main (&kick, &ban...), déjà pré-remplie avec ce membre — aucune
      // deuxième implémentation de l'action, juste un raccourci vers celle qui
      // existe déjà (voir utils/commandForms.js).
      const actions = [];
      if (can(member, "moderation.warn")) actions.push(["warn_member", "Warn", ButtonStyle.Secondary]);
      if (can(member, "moderation.timeout")) actions.push(["timeout_member", "Timeout", ButtonStyle.Secondary]);
      if (can(member, "moderation.kick")) actions.push(["kick_member", "Kick", ButtonStyle.Danger]);
      if (can(member, "moderation.ban")) actions.push(["ban_member", "Ban", ButtonStyle.Danger]);
      if (can(member, "logs.view")) actions.push([null, "Historique complet", ButtonStyle.Secondary]);
      if (actions.length) {
        container.addActionRowComponents(
          new ActionRowBuilder().addComponents(
            actions.slice(0, 5).map(([formKey, label, style]) =>
              new ButtonBuilder()
                .setCustomId(formKey ? `${ID}:modaction:${formKey}:${targetMember.id}` : `${ID}:modhistory:${targetMember.id}`)
                .setLabel(label)
                .setStyle(style)
            )
          )
        );
      }
      if (can(member, "members.role")) {
        container.addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${ID}:modaction:addrole_member:${targetMember.id}`).setLabel("Ajouter un rôle").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId(`${ID}:modaction:delrole_member:${targetMember.id}`).setLabel("Retirer un rôle").setStyle(ButtonStyle.Secondary)
          )
        );
      }
    }
  } else if (meta.key === "history") {
    if (!state.historySearchOpen) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${ID}:history:search`).setLabel("Rechercher").setStyle(ButtonStyle.Secondary)
        )
      );
    } else {
      const targetId = state.historySearchTarget || null;
      const moderatorId = state.historySearchModerator || null;
      const targetSelect = new UserSelectMenuBuilder()
        .setCustomId(`${ID}:historytarget:${moderatorId || "_"}`)
        .setPlaceholder("Filtrer par cible")
        .setMinValues(0)
        .setMaxValues(1);
      if (targetId) targetSelect.setDefaultUsers([targetId]);
      const moderatorSelect = new UserSelectMenuBuilder()
        .setCustomId(`${ID}:historymoderator:${targetId || "_"}`)
        .setPlaceholder("Filtrer par modérateur")
        .setMinValues(0)
        .setMaxValues(1);
      if (moderatorId) moderatorSelect.setDefaultUsers([moderatorId]);
      container.addActionRowComponents(new ActionRowBuilder().addComponents(targetSelect));
      container.addActionRowComponents(new ActionRowBuilder().addComponents(moderatorSelect));
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${ID}:historytextopen:${targetId || "_"}:${moderatorId || "_"}`)
            .setLabel("Filtrer par type/ID...")
            .setStyle(ButtonStyle.Secondary),
          new ButtonBuilder()
            .setCustomId(`${ID}:historyrun:${targetId || "_"}:${moderatorId || "_"}`)
            .setLabel("Rechercher")
            .setStyle(ButtonStyle.Success)
        )
      );
    }
  } else if (meta.key === "protection") {
    const words = badWords.getWords(guild.id);

    const options = [
      { value: "spam_toggle", label: "Anti-spam : activer/désactiver" },
      { value: "link_toggle", label: "Anti-lien : activer/désactiver" },
      { value: "link_mode", label: "Anti-lien : changer le mode (invitations ↔ tous les liens)" },
      { value: "mention_toggle", label: "Anti-mass-mention : activer/désactiver" },
      { value: "mention_threshold", label: "Anti-mass-mention : changer le seuil" },
      { value: "badwords_toggle", label: "Mots interdits : activer/désactiver" },
      { value: "badwords_add", label: "Mots interdits : ajouter un mot" },
      ...(words.length ? [{ value: "badwords_remove", label: "Mots interdits : retirer un mot" }] : []),
      ...(can(member, "protection.whitelist")
        ? [
            { value: "whitelist_add", label: "Whitelist : ajouter quelqu'un" },
            { value: "whitelist_remove", label: "Whitelist : retirer quelqu'un" },
          ]
        : []),
    ];

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${ID}:protectionaction`)
          .setPlaceholder("Choisir une action")
          .addOptions(options.map((o) => new StringSelectMenuOptionBuilder().setLabel(o.label.slice(0, 100)).setValue(o.value)))
      )
    );

    if (state.protectionAction === "badwords_add") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${ID}:badwords:add`).setLabel("Ouvrir la fenêtre d'ajout").setStyle(ButtonStyle.Secondary)
        )
      );
    } else if (state.protectionAction === "badwords_remove" && words.length) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ID}:badwords:del`)
            .setPlaceholder("Retirer un mot interdit")
            .addOptions(words.slice(0, 25).map((w) => new StringSelectMenuOptionBuilder().setLabel(w.slice(0, 100)).setValue(w)))
        )
      );
    } else if (state.protectionAction === "whitelist_add") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${ID}:wladd`).setPlaceholder("Ajouter à la whitelist anti-spam"))
      );
    } else if (state.protectionAction === "whitelist_remove") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${ID}:wldel`).setPlaceholder("Retirer de la whitelist anti-spam"))
      );
    }
    // Les autres actions (spam_toggle/link_toggle/link_mode/mention_toggle/
    // mention_threshold/badwords_toggle) s'exécutent immédiatement à la
    // sélection (voir le handler "protectionaction") — rien de plus à afficher.
  } else if (meta.key === "guard") {
    const config = guardConfig.getConfig(guild.id);

    const options = [
      { value: "guard_toggle", label: config.enabled ? "Anti-nuke : désactiver" : "Anti-nuke : activer" },
      { value: "guard_punishment", label: "Changer la sanction (timeout → kick → ban)" },
      { value: "guard_pick", label: "Activer/désactiver un guard précis" },
      { value: "guard_wl_add", label: "Whitelist : ajouter quelqu'un" },
      { value: "guard_wl_remove", label: "Whitelist : retirer quelqu'un" },
      { value: "guard_wl_role_add", label: "Whitelist : ajouter un rôle" },
      { value: "guard_wl_role_remove", label: "Whitelist : retirer un rôle" },
      { value: "guard_ping", label: "Changer le rôle pingé" },
      { value: "guard_creationlimit", label: "Changer le seuil de compte" },
      { value: "guard_autolockdown_toggle", label: config.autoLockdownOnCap ? "Verrouillage auto : désactiver" : "Verrouillage auto : activer" },
    ];

    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${ID}:guardaction`)
          .setPlaceholder("Choisir une action")
          .addOptions(options.map((o) => new StringSelectMenuOptionBuilder().setLabel(o.label.slice(0, 100)).setValue(o.value)))
      )
    );

    if (state.guardAction === "guard_pick") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ID}:guardpick`)
            .setPlaceholder("Choisir un guard")
            .addOptions(
              ALL_GUARDS.map((d) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(d.label.slice(0, 100))
                  .setDescription(d.key)
                  .setValue(d.key)
                  .setDefault(state.guardKey === d.key)
              )
            )
        )
      );
      if (state.guardKey) {
        const def = ALL_GUARDS.find((d) => d.key === state.guardKey);
        if (def) {
          const on = guardConfig.isGuardEnabled(guild.id, def.key);
          container.addActionRowComponents(
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`${ID}:guardtoggle:${def.key}`)
                .setLabel(`${def.label} : ${on ? "désactiver" : "activer"}`)
                .setStyle(on ? ButtonStyle.Danger : ButtonStyle.Success)
            )
          );
        }
      }
    } else if (state.guardAction === "guard_wl_add") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${ID}:guardwladd`).setPlaceholder("Ajouter à la whitelist anti-nuke"))
      );
    } else if (state.guardAction === "guard_wl_remove") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${ID}:guardwldel`).setPlaceholder("Retirer de la whitelist anti-nuke"))
      );
    } else if (state.guardAction === "guard_wl_role_add") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`${ID}:guardwlroleadd`).setPlaceholder("Ajouter un rôle à la whitelist anti-nuke"))
      );
    } else if (state.guardAction === "guard_wl_role_remove") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`${ID}:guardwlroledel`).setPlaceholder("Retirer un rôle de la whitelist anti-nuke"))
      );
    } else if (state.guardAction === "guard_ping") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new RoleSelectMenuBuilder()
            .setCustomId(`${ID}:guardping`)
            .setPlaceholder("Rôle à pinguer (vide = aucun)")
            .setMinValues(0)
            .setDefaultRoles(config.pingRoleId && guild.roles.cache.has(config.pingRoleId) ? [config.pingRoleId] : [])
        )
      );
    } else if (state.guardAction === "guard_creationlimit") {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`${ID}:guardcreationlimit`).setLabel("Régler le seuil de création de compte").setStyle(ButtonStyle.Secondary)
        )
      );
    }
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
  } else if (meta.key === "leave") {
    const config = leaveStore.getConfig(guild.id);
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${ID}:leavechannel`)
          .setPlaceholder("Envoyer le message de départ à ce salon")
          .addChannelTypes(ChannelType.GuildText)
          .setMinValues(0)
          .setMaxValues(1)
          .setDefaultChannels(config.channelId ? [config.channelId] : [])
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${ID}:leavedelete`)
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
        new ButtonBuilder().setCustomId(`${ID}:leaveadd`).setLabel("Ajouter un message").setStyle(ButtonStyle.Secondary)
      )
    );
    if (config.messages.length) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ID}:leavedel`)
            .setPlaceholder("Retirer un message")
            .addOptions(
              config.messages.map((m, i) => new StringSelectMenuOptionBuilder().setLabel(`${i + 1}. ${m}`.slice(0, 100)).setValue(String(i)))
            )
        )
      );
    }
  } else if (meta.key === "autorole") {
    const roleIds = autoroleStore.getRoleIds(guild.id);
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`${ID}:autoroleset`)
          .setPlaceholder("Choisir les rôles donnés à l'arrivée")
          .setMinValues(0)
          .setMaxValues(25)
          .setDefaultRoles(roleIds.filter((id) => guild.roles.cache.has(id)))
      )
    );
  } else if (meta.key === "verification") {
    const config = verificationStore.getConfig(guild.id);
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`${ID}:verifyrole`)
          .setPlaceholder("Rôle donné une fois vérifié")
          .setMinValues(0)
          .setMaxValues(1)
          .setDefaultRoles(config.roleId && guild.roles.cache.has(config.roleId) ? [config.roleId] : [])
      )
    );
    if (config.roleId) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`${ID}:verifypost`)
            .setLabel("Poster le bouton dans ce salon")
            .setStyle(ButtonStyle.Success)
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
  } else if (meta.key === "mute") {
    const roleId = muteStore.getMuteRoleId(guild.id);
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`${ID}:muterole`)
          .setPlaceholder("Choisir le rôle de mute (vide = aucun)")
          .setMinValues(0)
          .setDefaultRoles(roleId && guild.roles.cache.has(roleId) ? [roleId] : [])
      )
    );
  } else if (meta.key === "tickets") {
    const config = ticketStore.getConfig(guild.id);
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`${ID}:ticketstaff`)
          .setPlaceholder("Choisir le rôle staff (vide = aucun)")
          .setMinValues(0)
          .setDefaultRoles(config.staffRoleId && guild.roles.cache.has(config.staffRoleId) ? [config.staffRoleId] : [])
      )
    );
  } else if (meta.key === "voice") {
    const hubId = voiceChannels.getHub(guild.id);
    const hubConfig = voiceChannels.getHubConfig(guild.id);
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${ID}:voicehubchannel`)
          .setPlaceholder("Choisir le salon générateur")
          .addChannelTypes(ChannelType.GuildVoice)
          .setMinValues(0)
          .setMaxValues(1)
          .setDefaultChannels(hubId && guild.channels.cache.has(hubId) ? [hubId] : [])
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${ID}:voicespawncategory`)
          .setPlaceholder("Choisir la catégorie des salons créés (optionnel)")
          .addChannelTypes(ChannelType.GuildCategory)
          .setMinValues(0)
          .setMaxValues(1)
          .setDefaultChannels(hubConfig.spawnCategoryId && guild.channels.cache.has(hubConfig.spawnCategoryId) ? [hubConfig.spawnCategoryId] : [])
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${ID}:voicepanelchannel`)
          .setPlaceholder("Choisir le salon-panneau partagé (optionnel)")
          .addChannelTypes(ChannelType.GuildText)
          .setMinValues(0)
          .setMaxValues(1)
          .setDefaultChannels(hubConfig.panelChannelId && guild.channels.cache.has(hubConfig.panelChannelId) ? [hubConfig.panelChannelId] : [])
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${ID}:voicehubsetup`)
          .setLabel("Créer la configuration")
          .setStyle(ButtonStyle.Success)
          .setDisabled(Boolean(hubId && guild.channels.cache.has(hubId))),
        new ButtonBuilder().setCustomId(`${ID}:voicenames`).setLabel("Modifier les noms").setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`${ID}:voicepanelrefresh`)
          .setLabel("Actualiser le panneau")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!(hubConfig.panelChannelId && guild.channels.cache.has(hubConfig.panelChannelId)))
      )
    );
  } else if (meta.key === "giveaways") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:giveawaystart`).setLabel("Démarrer un giveaway").setStyle(ButtonStyle.Success)
      )
    );
    const active = giveawayStore
      .listForGuild(guild.id)
      .filter((g) => !g.ended)
      .sort((a, b) => a.endsAt - b.endsAt)
      .slice(0, 5);
    if (active.length) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ID}:giveawaypick`)
            .setPlaceholder("Choisir un giveaway en cours")
            .addOptions(
              active.map((g) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(g.prize.slice(0, 100))
                  .setDescription(`Se termine le ${new Date(g.endsAt).toLocaleString("fr-FR")}`.slice(0, 100))
                  .setValue(g.messageId)
                  .setDefault(g.messageId === state.giveawaySelected)
              )
            )
        )
      );
      if (state.giveawaySelected && active.some((g) => g.messageId === state.giveawaySelected)) {
        container.addActionRowComponents(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`${ID}:giveawayend:${state.giveawaySelected}`).setLabel("Terminer maintenant").setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId(`${ID}:giveawayreroll:${state.giveawaySelected}`)
              .setLabel("Retirer un gagnant (reroll)")
              .setStyle(ButtonStyle.Secondary)
          )
        );
      }
    }
  } else if (meta.key === "embedBuilder") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:embedbuild`).setLabel("Construire un embed").setStyle(ButtonStyle.Secondary)
      )
    );
  } else if (meta.key === "polls") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:pollstart`).setLabel("Créer un sondage").setStyle(ButtonStyle.Secondary)
      )
    );
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
    // Le menu principal donne une famille : on ouvre sa première rubrique
    // accessible, celle qui a le plus de chances d'être celle qu'on cherche.
    const famille = FAMILIES.find((f) => f.key === interaction.values[0]);
    const rubriques = famille ? familySections(famille, member, isOwner) : [];
    return goto(rubriques[0]?.key || "home");
  }

  if (action === "subnav") {
    return goto(interaction.values[0]);
  }

  if (action === "permrole") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    return goto("permissions", { permissionsRoleId: interaction.values[0] });
  }

  if (action === "permshowcmds" || action === "permhidecmds") {
    if (!can(member, "panel.permissions.manage") && !can(member, "panel.roles.manage")) {
      return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    }
    return goto("permissions", { permissionsRoleId: extra, permissionsShowCommands: action === "permshowcmds" });
  }

  // Réutilise TEL QUEL &rolemembers (utils/utilityCommands.js), jamais
  // exposé dans le panel jusqu'ici — même liste paginée qu'en tapant la
  // commande, juste ouverte depuis la fiche du rôle.
  if (action === "rolemembers") {
    if (!can(member, "server.members.list")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const role = guild.roles.cache.get(extra);
    await goto("permissions", { permissionsRoleId: extra });
    if (!role) return;
    await utilityHandlers.rolemembers(interaction.client, fakeMessage(interaction, { role }), []);
    return;
  }

  // Giveaways : démarrer réutilise la carte de formulaire existante
  // (utils/commandForms.js::FORMS.giveaway_start, celle que &giveaway ouvre
  // déjà bare) ; terminer/reroll appellent directement utils/giveaways.js
  // avec l'ID du message ciblé, jamais un second tirage réimplémenté.
  if (action === "giveawaystart") {
    if (!can(member, "server.giveaways.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    return interaction.reply(buildFormCard("giveaway_start", member));
  }

  if (action === "giveawaypick") {
    if (!can(member, "server.giveaways.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    return goto("giveaways", { giveawaySelected: interaction.values[0] || null });
  }

  if (action === "giveawayend" || action === "giveawayreroll") {
    if (!can(member, "server.giveaways.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const messageId = extra;
    const giveaway = giveawayStore.get(messageId);
    await goto("giveaways", { giveawaySelected: null });
    const channel = giveaway && guild.channels.cache.get(giveaway.channelId);
    if (!channel) return;
    const msg = fakeMessage(interaction, { channel });
    if (action === "giveawayend") await endGiveaway(interaction.client, msg, [messageId]);
    else await rerollGiveaway(interaction.client, msg, [messageId]);
    return;
  }

  // Communication : le bouton ouvre EXACTEMENT ce que &embed/&poll ouvrent
  // déjà (modale / carte de formulaire) — aucune deuxième implémentation.
  if (action === "embedbuild") {
    return handleEmbedButton(interaction);
  }

  if (action === "pollstart") {
    if (!can(member, "server.polls.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    return interaction.reply(buildFormCard("poll_create", member));
  }

  // Création/suppression de rôle depuis le panel : réutilise TEL QUEL
  // utils/serverAdminCommands.js::roleAdmin (même vérif de droits, même
  // journal, même confirmation avant suppression) via un objet "message"
  // minimal — pas de logique dupliquée entre &role create/delete et ces
  // boutons.
  if (action === "rolecreate") {
    if (!can(member, "server.roles.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    if (interaction.isModalSubmit()) {
      const name = interaction.fields.getTextInputValue("name").trim();
      if (!name) return interaction.reply({ content: "Nom vide, aucun rôle créé.", flags: MessageFlags.Ephemeral });
      await roleAdmin(interaction.client, messageFromInteraction(interaction), ["create", name]);
      return;
    }
    const modal = new ModalBuilder().setCustomId(`${ID}:rolecreate`).setTitle("Créer un rôle");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("name").setLabel("Nom du rôle").setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "roledelete") {
    if (!can(member, "server.roles.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    await roleAdmin(interaction.client, messageFromInteraction(interaction), ["delete", extra]);
    return;
  }

  // "Exclusif" : simple étiquette côté panel, aucun effet sur le calcul des
  // permissions (voir utils/permissions/store.js).
  if (action === "roleexclusive" || action === "roleexclusiveoff") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    permStore.setRoleExclusive(guildId, extra, action === "roleexclusive");
    return goto("permissions", { permissionsRoleId: extra });
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

  // "roleinfo" et "jumpperm" appartenaient à la rubrique "Rôles", fusionnée
  // dans "Rôles et permissions" : une carte restée ouverte peut encore les
  // envoyer, on la redirige plutôt que de la laisser sans effet.
  if (action === "roleinfo") {
    return goto("permissions", { permissionsRoleId: interaction.values[0] });
  }

  if (action === "jumpperm") {
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

  if (action === "logdelete") {
    if (!can(member, "logs.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const botPerm = checkBotPermission(guild, PermissionFlagsBits.ManageChannels, "ManageChannels");
    if (botPerm) return interaction.reply({ content: botPerm, flags: MessageFlags.Ephemeral });

    const { deleted } = await deleteLogChannelsAutomatically(guild);
    await interaction.reply({
      content: deleted.length
        ? `${deleted.length} salon(s) de logs supprimé(s). Utilise "Créer les salons automatiquement" pour les recréer.`
        : "Aucun salon de logs configuré, rien à supprimer.",
      flags: MessageFlags.Ephemeral,
    });
    return goto("logs");
  }

  // Centre de modération : chercher un membre, puis agir sur sa fiche.
  if (action === "modtarget") {
    if (!canOpenModCenter(member)) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const targetId = interaction.values[0] || null;
    // Un fetch ciblé (pas guild.members.fetch() complet) garantit une fiche à
    // jour même si ce membre précis n'était pas déjà en cache — sectionBody
    // reste lui synchrone et lit ensuite le cache tel quel.
    if (targetId) await guild.members.fetch(targetId).catch(() => {});
    return goto("modCenter", { modTargetId: targetId });
  }

  // Chaque bouton de la fiche membre ouvre la carte de formulaire EXISTANTE
  // (utils/commandForms.js, celle que &kick/&ban/&timeout/&warn/... ouvrent
  // déjà) pré-remplie avec ce membre — jamais une deuxième exécution de
  // l'action. La carte est posée comme nouveau message public, exactement
  // comme quand on tape la commande à vide.
  if (action === "modaction") {
    const formKey = extra;
    const targetId = extra2;
    const form = FORMS[formKey];
    if (!form) return;
    if (form.permission !== undefined && !can(member, form.permission)) {
      return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    }
    setFormState(member.id, formKey, { userId: targetId });
    return interaction.reply(buildFormCard(formKey, member));
  }

  if (action === "modhistory") {
    if (!can(member, "logs.view")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const targetId = extra;
    const results = historyStore.search(guildId, { targetId, limit: 10 });
    await goto("modCenter", { modTargetId: targetId });
    const resultContainer = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## Historique complet\n${formatHistoryResults(results).slice(0, 3800)}`)
    );
    return interaction.followUp({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [resultContainer] });
  }

  // Recherche d'historique : cible/modérateur se choisissent désormais via
  // UserSelectMenu natif (chips + avatars) au lieu d'un ID/mention tapé à la
  // main — un Modal Discord ne pouvant pas contenir de select menu, le
  // bouton "Rechercher" ouvre maintenant une carte dans le panel lui-même
  // plutôt qu'un Modal direct. Le type d'événement/l'ID précis restent du
  // texte libre (aucun équivalent natif) via un Modal réduit, ouvert depuis
  // cette carte et qui porte cible/modérateur dans son propre customId pour
  // ne pas les perdre.
  if (action === "history" && extra === "search") {
    if (!can(member, "logs.view")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    return goto("history", { historySearchOpen: true });
  }

  if (action === "historytarget" || action === "historymoderator") {
    if (!can(member, "logs.view")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const other = extra !== "_" ? extra : null;
    const chosen = interaction.values[0] || null;
    return goto("history", {
      historySearchOpen: true,
      historySearchTarget: action === "historytarget" ? chosen : other,
      historySearchModerator: action === "historymoderator" ? chosen : other,
    });
  }

  if (action === "historytextopen") {
    if (!can(member, "logs.view")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const modal = new ModalBuilder().setCustomId(`${ID}:historytextsubmit:${extra}:${extra2}`).setTitle("Filtrer par type/ID");
    modal.addComponents(
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

  if (action === "historytextsubmit") {
    if (!can(member, "logs.view")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    return handleHistorySearchModal(interaction, {
      targetId: extra !== "_" ? extra : null,
      moderatorId: extra2 !== "_" ? extra2 : null,
    });
  }

  if (action === "historyrun") {
    if (!can(member, "logs.view")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const targetId = extra !== "_" ? extra : null;
    const moderatorId = extra2 !== "_" ? extra2 : null;
    const results = historyStore.search(guildId, { targetId: targetId || undefined, moderatorId: moderatorId || undefined, limit: 10 });
    await interaction.update(
      buildConfigPanel(guild, "history", member, { historySearchOpen: true, historySearchTarget: targetId, historySearchModerator: moderatorId })
    );
    const resultContainer = new ContainerBuilder().addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## Résultats de recherche\n${formatHistoryResults(results).slice(0, 3800)}`)
    );
    return interaction.followUp({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [resultContainer] });
  }

  if (action === "protectionaction") {
    const choice = interaction.values[0];
    const requiredPerm = choice.startsWith("whitelist_") ? "protection.whitelist" : "protection.automod";
    if (!can(member, requiredPerm)) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });

    if (choice === "spam_toggle") {
      automod.setEnabled(guildId, !automod.getConfig(guildId).enabled);
      return goto("protection");
    }
    if (choice === "link_toggle") {
      antiLink.setEnabled(guildId, !antiLink.getConfig(guildId).enabled);
      return goto("protection");
    }
    if (choice === "link_mode") {
      antiLink.setMode(guildId, antiLink.getConfig(guildId).mode === "all" ? "invite" : "all");
      return goto("protection");
    }
    if (choice === "mention_toggle") {
      antiMention.setEnabled(guildId, !antiMention.getConfig(guildId).enabled);
      return goto("protection");
    }
    if (choice === "mention_threshold") {
      const steps = [3, 5, 8, 10, 15, 20];
      const current = antiMention.getConfig(guildId).maxMentions;
      antiMention.setMaxMentions(guildId, steps.find((n) => n > current) || steps[0]);
      return goto("protection");
    }
    if (choice === "badwords_toggle") {
      badWords.setEnabled(guildId, !badWords.getConfig(guildId).enabled);
      return goto("protection");
    }
    // badwords_add / badwords_remove / whitelist_add / whitelist_remove : révèle le contrôle correspondant.
    return goto("protection", { protectionAction: choice });
  }

  if (action === "wladd" || action === "wldel") {
    if (!can(member, "protection.whitelist")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const userId = interaction.values[0];
    if (action === "wladd") automod.addToWhitelist(guildId, "users", userId);
    else automod.removeFromWhitelist(guildId, "users", userId);
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

  if (action === "guardaction") {
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const choice = interaction.values[0];
    if (choice === "guard_toggle") {
      guardConfig.setEnabled(guildId, !guardConfig.getConfig(guildId).enabled);
      return goto("guard");
    }
    if (choice === "guard_punishment") {
      const next = { timeout: "kick", kick: "ban", ban: "timeout" }[guardConfig.getConfig(guildId).punishment];
      guardConfig.setPunishment(guildId, next);
      return goto("guard");
    }
    if (choice === "guard_autolockdown_toggle") {
      guardConfig.setAutoLockdown(guildId, !guardConfig.getConfig(guildId).autoLockdownOnCap);
      return goto("guard");
    }
    // guard_pick / guard_wl_add / guard_wl_remove : révèle le contrôle correspondant.
    return goto("guard", { guardAction: choice });
  }

  if (action === "guardpick") {
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    return goto("guard", { guardAction: "guard_pick", guardKey: interaction.values[0] });
  }

  if (action === "guardtoggle") {
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    guardConfig.toggleGuard(guildId, extra);
    return goto("guard", { guardAction: "guard_pick", guardKey: extra });
  }

  if (action === "guardwladd" || action === "guardwldel") {
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const userId = interaction.values[0];
    if (action === "guardwladd") guardWhitelist.add(guildId, "users", userId);
    else guardWhitelist.remove(guildId, "users", userId);
    return goto("guard");
  }

  if (action === "guardwlroleadd" || action === "guardwlroledel") {
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const roleId = interaction.values[0];
    if (action === "guardwlroleadd") guardWhitelist.add(guildId, "roles", roleId);
    else guardWhitelist.remove(guildId, "roles", roleId);
    return goto("guard");
  }

  if (action === "guardping") {
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    guardConfig.setPingRole(guildId, interaction.values[0] || null);
    return goto("guard");
  }

  if (action === "guardcreationlimit") {
    if (interaction.isModalSubmit()) {
      const raw = interaction.fields.getTextInputValue("duration").trim();
      if (!raw || raw.toLowerCase() === "off") {
        guardConfig.setCreationLimit(guildId, 0);
        await interaction.reply({ content: "Seuil de création de compte désactivé.", flags: MessageFlags.Ephemeral });
        return interaction.message?.edit(buildConfigPanel(guild, "guard", member)).catch(() => {});
      }
      const ms = parseDuration(raw);
      if (!ms) {
        return interaction.reply({ content: "Durée invalide — exemple : `7d`, ou `off` pour désactiver.", flags: MessageFlags.Ephemeral });
      }
      guardConfig.setCreationLimit(guildId, ms);
      await interaction.reply({ content: `Comptes créés il y a moins de **${raw}** sanctionnés à l'arrivée.`, flags: MessageFlags.Ephemeral });
      return interaction.message?.edit(buildConfigPanel(guild, "guard", member)).catch(() => {});
    }
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const modal = new ModalBuilder().setCustomId(`${ID}:guardcreationlimit`).setTitle("Seuil de création de compte");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("duration")
          .setLabel('Durée (ex: 7d, 12h) ou "off"')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(20)
          .setRequired(false)
      )
    );
    return interaction.showModal(modal);
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

  if (action === "leavechannel") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    leaveStore.setChannel(guildId, interaction.values[0] || null);
    return goto("leave");
  }

  if (action === "leavedelete") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    leaveStore.setAutoDelete(guildId, parseInt(interaction.values[0], 10) || 0);
    return goto("leave");
  }

  if (action === "leavedel") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    leaveStore.removeMessage(guildId, parseInt(interaction.values[0], 10));
    return goto("leave");
  }

  if (action === "leaveadd") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    if (interaction.isModalSubmit()) {
      const text = interaction.fields.getTextInputValue("value").trim();
      if (!text) return interaction.reply({ content: "Message vide, rien n'a été ajouté.", flags: MessageFlags.Ephemeral });
      leaveStore.addMessage(guildId, text);
      await interaction.reply({ content: "Message de départ ajouté.", flags: MessageFlags.Ephemeral });
      return interaction.message?.edit(buildConfigPanel(guild, "leave", member)).catch(() => {});
    }
    const modal = new ModalBuilder().setCustomId(`${ID}:leaveadd`).setTitle("Ajouter un message de départ");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("value")
          .setLabel('Message ("{user}" = pseudo de la personne)')
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(1000)
          .setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "autoroleset") {
    if (!can(member, "members.autorole.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    autoroleStore.setRoleIds(guildId, interaction.values);
    return goto("autorole");
  }

  if (action === "verifyrole") {
    if (!can(member, "members.verification.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    verificationStore.setRole(guildId, interaction.values[0] || null);
    return goto("verification");
  }

  if (action === "verifypost") {
    if (!can(member, "members.verification.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    const config = verificationStore.getConfig(guildId);
    if (!config.roleId || !guild.roles.cache.has(config.roleId)) {
      return interaction.reply({ content: "Choisis d'abord un rôle valide.", flags: MessageFlags.Ephemeral });
    }
    verificationStore.setChannel(guildId, interaction.channel.id);
    const verifyContainer = new ContainerBuilder();
    verifyContainer.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## Vérification\nClique ci-dessous pour accéder au reste du serveur.")
    );
    verifyContainer.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("verify:claim").setLabel("Se vérifier").setStyle(ButtonStyle.Success)
      )
    );
    await interaction.channel.send({ flags: MessageFlags.IsComponentsV2, components: [verifyContainer] });
    await interaction.reply({ content: "Message de vérification envoyé dans ce salon.", flags: MessageFlags.Ephemeral });
    return goto("verification");
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

  if (action === "muterole") {
    if (!can(member, "protection.automod")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    muteStore.setMuteRoleId(guildId, interaction.values[0] || null);
    return goto("mute");
  }

  if (action === "ticketstaff") {
    if (!can(member, "server.tickets.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    ticketStore.setStaffRole(guildId, interaction.values[0] || null);
    return goto("tickets");
  }

  if (action === "voicehubchannel") {
    if (!can(member, "server.voice.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    voiceChannels.setHub(guildId, interaction.values[0] || null);
    return goto("voice");
  }

  if (action === "voicespawncategory") {
    if (!can(member, "server.voice.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    voiceChannels.setSpawnCategory(guildId, interaction.values[0] || null);
    return goto("voice");
  }

  if (action === "voicepanelchannel") {
    if (!can(member, "server.voice.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    voiceChannels.setPanelChannel(guildId, interaction.values[0] || null);
    return goto("voice");
  }

  if (action === "voicehubsetup") {
    if (!can(member, "server.voice.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    if (voiceHubSetup.isAlreadyConfigured(guild)) {
      return interaction.reply({ content: "Un générateur est déjà actif — change-le via le sélecteur plutôt que d'en recréer un.", flags: MessageFlags.Ephemeral });
    }
    await interaction.deferUpdate();
    const { hubCategory, spawnCategory, hubChannel, panelChannel } = await voiceHubSetup.createVoiceHubSetup(guild);
    await interaction
      .followUp({
        content: `Configuration créée : ${hubCategory} > ${hubChannel} (rejoindre crée un salon), ${spawnCategory} pour les salons créés, et ${panelChannel} pour les gérer.`,
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return interaction.message?.edit(buildConfigPanel(guild, "voice", member)).catch(() => {});
  }

  if (action === "voicepanelrefresh") {
    if (!can(member, "server.voice.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
    await interaction.deferUpdate();
    const ok = await voiceHubSetup.refreshPanelCard(guild);
    await interaction
      .followUp({
        content: ok ? "Panneau actualisé — les libellés/boutons repris sont ceux de la version actuelle du bot." : "Aucun salon-panneau configuré.",
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  if (action === "voicenames") {
    if (interaction.isModalSubmit()) {
      const voiceNameTemplate = interaction.fields.getTextInputValue("voice").trim();
      voiceChannels.setNameTemplates(guildId, { voiceNameTemplate });
      await interaction.reply({ content: "Modèle de nom enregistré.", flags: MessageFlags.Ephemeral });
      return interaction.message?.edit(buildConfigPanel(guild, "voice", member)).catch(() => {});
    }
    if (!can(member, "server.voice.manage")) return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });

    const current = voiceChannels.getHubConfig(guildId);
    const modal = new ModalBuilder().setCustomId(`${ID}:voicenames`).setTitle("Modèle de nom des salons");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("voice")
          .setLabel("Nom du salon vocal créé ({pseudo})")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(90)
          .setRequired(true)
          .setValue(current.voiceNameTemplate)
      )
    );
    return interaction.showModal(modal);
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

/**
 * Traite la soumission du Modal réduit (type d'événement + ID précis, voir
 * index.js) — cible/modérateur viennent de la carte (UserSelectMenu natif),
 * portés dans le customId du Modal, pas retapés ici.
 * @param {{ targetId: string|null, moderatorId: string|null }} [carried]
 */
async function handleHistorySearchModal(interaction, carried = {}) {
  if (!can(interaction.member, "logs.view")) {
    return interaction.reply({ content: "Accès refusé.", flags: MessageFlags.Ephemeral });
  }
  const actionRaw = interaction.fields.getTextInputValue("action").trim();
  const idRaw = interaction.fields.getTextInputValue("id").trim();

  const results = historyStore.search(interaction.guild.id, {
    targetId: carried.targetId || undefined,
    moderatorId: carried.moderatorId || undefined,
    action: actionRaw || undefined,
    id: idRaw || undefined,
    limit: 10,
  });

  const resultContainer = new ContainerBuilder().addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## Résultats de recherche\n${formatHistoryResults(results).slice(0, 3800)}`)
  );
  return interaction.reply({ flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [resultContainer] });
}

module.exports = { buildConfigPanel, handleConfigInteraction, handleHistorySearchModal, hasAnyPanelAccess, ID, SECTIONS };
