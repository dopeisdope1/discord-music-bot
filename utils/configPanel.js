const {
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
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
const { EMOJI } = require("./emojis");
const { rendreEnCache, resumer, enTexte } = require("./dashboardImage");
const sectionDashboard = require("./sectionDashboard");
const { rendreCarteActionSync, prechargerAvatar, avatarDe, nomDe } = require("./actionCard");
const accessStore = require("./accessStore");
const { can } = require("./permissions/engine");
const permCatalog = require("./permissions/catalog");
const permStore = require("./permissions/store");
const { commandsForKeys, nonCommandGrants } = require("./permsCommands");
const { sweepGuild } = require("./permissions/cleanup");
const { checkBotPermission } = require("./moderation/actions");
const { getAllLogChannels, setLogChannelId, CATEGORY_LABELS: LOG_CATEGORY_LABELS } = require("./modLogStore");
const statsStore = require("./statsStore");
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
const { buildFavoritesPanel } = require("./favoritesPanel");
const { LOOP_LABELS } = require("./nowPlayingPanel");
const backupStore = require("./serverBackupStore");
const { backup, countChannels, PRESET_BACKUPS } = require("./serverBackup");
const botProfileStore = require("./botProfileStore");
const { botProfileHandlers, STATUS_LABELS } = require("./botProfileCommands");

// Même variable d'environnement que index.js/musicCommands.js — musique
// suspendue = rubrique Musique masquée du panel elle aussi (famille "musique"
// automatiquement retirée du menu, buildNav ne montrant déjà que les
// familles ayant au moins une rubrique visible).
const MUSIC_ENABLED = process.env.MUSIC_ENABLED !== "false";

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
  { key: "history", label: "Historique", description: "Rechercher dans l'historique de modération", permission: "logs.view" },
  { key: "stats", label: "Statistiques", description: "Compteurs serveur et activité des 7 derniers jours", permission: "server.stats.view" },
  { key: "diagnostics", label: "Diagnostics", description: "Uptime, latence, mémoire, nœuds Lavalink", permission: "sys" },
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
  // Pas de `permission` : &play/&pause... ne sont pas gated par le moteur de
  // permissions (seule l'appartenance au même salon vocal compte, voir
  // index.js::canControlPlayer) — cette rubrique reste donc publique elle
  // aussi, comme les commandes qu'elle affiche/relie.
  { key: "musicPlayer", label: "Musique", description: "Lecteur en cours et favoris", enabled: MUSIC_ENABLED },
  { key: "access", label: "Accès panel", description: "Qui a accès, nettoyage des accès obsolètes", permission: "sys" },
  { key: "backups", label: "Sauvegardes", description: "Structure du serveur : créer, restaurer, supprimer", permission: "sys" },
  { key: "botProfile", label: "Profil du bot", description: "Statut et nom du bot (partagés sur tous les serveurs)", permission: "sys" },
  { key: "sys", label: "Rang sys", description: "Qui a accès à tout le bot", ownerOnly: true },
  { key: "banall", label: "Ban de masse", description: "Qui peut lancer un ban de masse", ownerOnly: true },
];

function sectionVisible(section, member, isOwner) {
  // Indépendant des droits : une rubrique dont la fonctionnalité sous-jacente
  // est globalement coupée (ex : musique suspendue) reste masquée pour tout
  // le monde, y compris le propriétaire — volontairement testé AVANT tout le
  // reste, et volontairement un champ distinct de `visible`/`permission` :
  // ceux-ci comptent pour hasAnyPanelAccess (une vraie vérification de droit),
  // alors qu'un simple interrupteur de fonctionnalité n'en est pas un.
  if (section.enabled === false) return false;
  if (section.key === "home") return true;
  if (section.ownerOnly) return isOwner;
  if (section.visible) return section.visible(member);
  return can(member, section.permission);
}

const sectionsFor = (member, isOwner) => SECTIONS.filter((s) => sectionVisible(s, member, isOwner));

/**
 * Vrai si la personne a accès à AU MOINS une rubrique qui exige un vrai droit
 * pour apparaître — condition d'entrée de &panel. Une rubrique sans
 * `permission`/`visible`/`ownerOnly` (Accueil, Musique — ni l'une ni l'autre
 * gated par le moteur de permissions, voir leurs commentaires dans SECTIONS)
 * est visible à tout le monde et NE COMPTE PAS ici : sinon &panel
 * deviendrait accessible à quiconque n'a strictement aucun droit, juste
 * parce qu'une rubrique publique existe.
 */
function hasAnyPanelAccess(member) {
  const isOwner = accessStore.isOwner(member.id);
  return sectionsFor(member, isOwner).some((s) => s.ownerOnly || s.visible || s.permission != null);
}

// Rubrique à rouvrir après avoir modifié une portée legacy (accessStore) :
// "clear" et "salon" vivent toutes deux sous "moderation" ici.
const SECTION_OF_SCOPE = { clear: "moderation", salon: "moderation", sys: "sys", banall: "banall" };

const mentions = (ids) => (ids.length ? ids.map((id) => `<@${id}>`).join(", ") : "*personne*");

// Rubriques regroupées par FAMILLE (centre de contrôle, refonte du panel) :
// le menu principal ne montre que les familles, un second menu n'apparaît
// que pour choisir une rubrique dans la famille ouverte. Onze familles
// cibles au total (Accueil/Sécurité/Modération/Serveur/Communauté/Support/
// Communication/Musique/Monitoring/Sauvegardes/Bot), toutes présentes
// désormais.
//
// Les écrans eux-mêmes ne sont PAS fusionnés — chacun garde ses contrôles et
// ses avertissements. "Rang sys" et "Ban de masse" voisinent dans la même
// famille sans jamais partager le même écran : l'un donne accès à tout le bot,
// l'autre bannit le serveur entier, et un mauvais clic ne pardonne pas.
// L'accueil du panel est rendu en image (même moteur que &help, voir
// utils/dashboardImage.js) : nom de fichier fixe, référencé par
// "attachment://" dans le composant MediaGallery.
const NOM_IMAGE_PANEL = "centre-de-gestion.png";
const NOM_IMAGE_RUBRIQUE = "rubrique.png";

// Une couleur par famille — c'est tout l'intérêt de l'image : un Container
// Components V2 n'a qu'UNE couleur d'accent pour tout le message.
// Une teinte par rubrique : c'est elle qui colore le liseré et le titre de
// l'image. Les sujets proches partagent une famille de couleur (protection en
// vert, communauté en ambre, réglages du bot en gris-bleu) pour que le panel
// garde une cohérence malgré le nombre d'entrées.
const FAMILY_COLORS = {
  securite: "#4ade80",
  logs: "#60a5fa",
  bienvenue: "#fbbf24",
  depart: "#f59e0b",
  vocaux: "#2dd4bf",
  permissions: "#a78bfa",
  autorole: "#8b5cf6",
  verification: "#22d3ee",
  tickets: "#38bdf8",
  giveaways: "#fb923c",
  sondages: "#f472b6",
  annonces: "#ec4899",
  musique: "#2dd4bf",
  historique: "#94a3b8",
  statistiques: "#60a5fa",
  diagnostics: "#818cf8",
  sauvegardes: "#fb923c",
  profil: "#94a3b8",
  prefixes: "#94a3b8",
  acces: "#a3a3a3",
  sys: "#ff6b6b",
  banall: "#ff6b6b",
  dispenses: "#a3a3a3",
};

// Le menu du panel liste des SUJETS CONCRETS — Logs, Bienvenue, Vocaux
// temporaires, Permissions, Giveaways — et non plus des familles abstraites
// ("Serveur", "Communauté", "Communication") dans lesquelles il fallait
// deviner ce qui se cachait. Demande explicite : « je veux genre des rubriques
// comme Logs, Sécurité, Bienvenue, Voc temporaire, Permission, Giveaway ».
//
// Chaque entrée ne contient donc qu'UNE rubrique, sauf Sécurité qui en
// regroupe quatre : ses écrans (vue d'ensemble, anti-spam, anti-nuke, rôle de
// mute) forment un seul sujet, et les séparer au premier niveau noierait le
// reste. C'est la seule qui affiche encore un sous-menu.
//
// Un menu déroulant Discord accepte 25 options au maximum : la liste
// ci-dessous en compte moins, et le test scripts/test-panel-rubriques.js
// échoue si elle venait à dépasser.
const FAMILIES = [
  { key: "accueil", label: "Accueil", description: "Statut du bot et alertes de sécurité", emoji: EMOJI.MEMBERS, sections: ["home"] },
  {
    key: "securite",
    label: "Sécurité",
    description: "Anti-spam, anti-nuke, mots interdits, rôle de mute",
    emoji: EMOJI.LOCK,
    sections: ["securityOverview", "protection", "guard", "mute"],
  },
  { key: "logs", label: "Logs", description: "Salon de logs par catégorie", emoji: EMOJI.ONLINE, sections: ["logs"] },
  { key: "bienvenue", label: "Bienvenue", description: "Message à l'arrivée d'un membre", emoji: EMOJI.MAIL, sections: ["welcome"] },
  { key: "depart", label: "Départ", description: "Message quand un membre s'en va", emoji: EMOJI.MAIL, sections: ["leave"] },
  { key: "vocaux", label: "Vocaux temporaires", description: "Salon générateur de vocaux à la demande", emoji: EMOJI.VOICE, sections: ["voice"] },
  { key: "permissions", label: "Permissions", description: "Ce qu'un rôle débloque comme commandes", emoji: EMOJI.PENCIL, sections: ["permissions"] },
  { key: "autorole", label: "Rôles automatiques", description: "Rôles donnés à chaque arrivée", emoji: EMOJI.PENCIL, sections: ["autorole"] },
  { key: "verification", label: "Vérification", description: "Bouton « Se vérifier » et rôle accordé", emoji: EMOJI.CHECK, sections: ["verification"] },
  { key: "tickets", label: "Tickets", description: "Système de tickets d'assistance", emoji: EMOJI.TICKET, sections: ["tickets"] },
  { key: "giveaways", label: "Giveaways", description: "Concours en cours, tirage et reroll", emoji: EMOJI.BOING, sections: ["giveaways"] },
  { key: "sondages", label: "Sondages", description: "Créer un sondage à boutons", emoji: EMOJI.RULES, sections: ["polls"] },
  { key: "annonces", label: "Annonces", description: "Composer et envoyer un embed", emoji: EMOJI.MAIL, sections: ["embedBuilder"] },
  { key: "musique", label: "Musique", description: "Lecteur en cours et favoris", emoji: EMOJI.VOICE, sections: ["musicPlayer"] },
  { key: "historique", label: "Historique", description: "Rechercher dans l'historique de modération", emoji: EMOJI.INFO, sections: ["history"] },
  { key: "statistiques", label: "Statistiques", description: "Compteurs et activité des 7 derniers jours", emoji: EMOJI.ONLINE, sections: ["stats"] },
  { key: "diagnostics", label: "Diagnostics", description: "Uptime, latence, mémoire, nœuds Lavalink", emoji: EMOJI.INFO, sections: ["diagnostics"] },
  { key: "sauvegardes", label: "Sauvegardes", description: "Sauvegarder et restaurer la structure", emoji: EMOJI.ARROW, sections: ["backups"] },
  { key: "profil", label: "Profil du bot", description: "Nom, photo, bannière et statut du bot", emoji: EMOJI.DISCORD, sections: ["botProfile"] },
  { key: "prefixes", label: "Préfixes", description: "Préfixe musique et préfixe des commandes", emoji: EMOJI.DISCORD, sections: ["prefixes"] },
  { key: "acces", label: "Accès panel", description: "Qui peut ouvrir ce panneau", emoji: EMOJI.STAFF, sections: ["access"] },
  { key: "sys", label: "Rang sys", description: "Qui a accès à tout le bot", emoji: EMOJI.CROWN, sections: ["sys"] },
  { key: "banall", label: "Ban de masse", description: "Qui peut lancer un ban de masse", emoji: EMOJI.BAN, sections: ["banall"] },
  { key: "dispenses", label: "Dispenses", description: "Qui échappe au quota de nettoyage", emoji: EMOJI.STAFF_AWAY, sections: ["moderation"] },
];


const familyOf = (sectionKey) => FAMILIES.find((f) => f.sections.includes(sectionKey)) || FAMILIES[0];

/** Rubriques d'une famille auxquelles la personne a réellement droit. */
function familySections(family, member, isOwner) {
  const visibles = sectionsFor(member, isOwner);
  return family.sections.map((key) => visibles.find((s) => s.key === key)).filter(Boolean);
}

/**
 * Menu déroulant de navigation entre familles — même contrôle que &help
 * (identité partagée "Centre de commandes" / "Centre de gestion"). Une
 * rangée de boutons occupait presque tout l'écran sur mobile avec dix
 * familles ; un menu tient sur une ligne et marque la famille ouverte avec
 * `setDefault`. Reste, pour mémoire, l'ancienne logique : la famille active
 * ressortait en style Primary, les
 * autres en Secondary, réparties sur autant de rangées de 5 que nécessaire
 * (limite Discord par ActionRow). Remplace l'ancien menu déroulant.
 * @returns {import('discord.js').ActionRowBuilder[]}
 */
function buildNav(current, member, isOwner) {
  const famille = familyOf(current);
  const disponibles = FAMILIES.filter((f) => familySections(f, member, isOwner).length);
  return new StringSelectMenuBuilder()
    .setCustomId(`${ID}:nav`)
    .setPlaceholder("Choisir une famille")
    .addOptions(
      disponibles.map((f) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(f.label)
          .setValue(f.key)
          .setEmoji(f.emoji)
          // Discord plafonne la description d'une option à 100 caractères.
          .setDescription(f.description.slice(0, 100))
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

  if (section === "stats") {
    const inVoice = guild.voiceStates.cache.filter((v) => v.channelId).size;
    const range = statsStore.getRange(guildId, 7);
    const totalMessages = range.reduce((sum, d) => sum + d.messages, 0);
    const totalJoins = range.reduce((sum, d) => sum + d.joins, 0);
    const totalLeaves = range.reduce((sum, d) => sum + d.leaves, 0);
    const lines = [
      `> **Membres** : ${guild.memberCount.toLocaleString("fr-FR")} · **rôles** : ${guild.roles.cache.size} · **salons** : ${guild.channels.cache.size} · **en vocal** : ${inVoice}`,
      `> **7 derniers jours** : ${totalMessages} message(s) · ${totalJoins} arrivée(s) · ${totalLeaves} départ(s)`,
    ];
    const lastDays = range.slice(-3);
    if (lastDays.length) {
      lines.push("", "**Détail (3 derniers jours) :**");
      // Libellés en toutes lettres, pas en emojis : la rubrique est DESSINÉE
      // (utils/sectionDashboard.js) et la police embarquée n'a aucun glyphe
      // emoji — « 💬 0 · 🟢 0 · 🔴 0 » sortirait en « 0 · 0 · 0 » entre des
      // carrés vides. Même formulation que la ligne « 7 derniers jours »
      // juste au-dessus, qui était déjà en mots.
      for (const d of lastDays) lines.push(`> **${d.date}** : ${d.messages} message(s) · ${d.joins} arrivée(s) · ${d.leaves} départ(s)`);
    }
    return lines.join("\n");
  }

  if (section === "diagnostics") {
    const info = computeStatus(guild.client);
    const lavalink = info.lavalinkNodes.length
      ? info.lavalinkNodes.map((n) => `> \`${n.name}\` : ${n.connected ? "🟢 connecté" : `🔴 état ${n.state}`}`).join("\n")
      : "> *aucun nœud déclaré*";
    return [
      `> **Uptime** : ${formatUptime(info.uptimeMs)} · **latence** : ${info.ping}ms · **mémoire** : ${info.memoryRssMB} Mo`,
      `> **Serveurs** : ${info.guildCount} · **Node.js** : ${info.nodeVersion} · **discord.js** : v${info.discordjsVersion}`,
      "",
      "**Lavalink :**",
      lavalink,
    ].join("\n");
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

  if (section === "backups") {
    const saved = backupStore.listBackups();
    const presets = Object.keys(PRESET_BACKUPS).map((name) => ({
      name,
      sourceGuildName: PRESET_BACKUPS[name].sourceGuildName,
      channelCount: countChannels(PRESET_BACKUPS[name]),
      preset: true,
    }));
    const all = [...presets, ...saved];
    if (!all.length) return "> *Aucune sauvegarde enregistrée.*";
    return all
      .map((b) => `> **${b.name}**${b.preset ? " *(préréglage)*" : ""} — ${b.channelCount} salon(s) — ${b.sourceGuildName}`)
      .join("\n");
  }

  if (section === "botProfile") {
    const config = botProfileStore.getConfig();
    const activity = config.activities?.[config.rotateIndex % (config.activities.length || 1)];
    return [
      `> **Statut** : ${STATUS_LABELS[config.status] || config.status}`,
      `> **Activité** : ${config.activityType && activity ? `${config.activityType} — ${activity}` : "*aucune*"}`,
      config.activities?.length > 1 ? `> **Rotation** : ${config.activities.length} phrase(s)` : null,
    ]
      .filter((l) => l !== null)
      .join("\n");
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

  if (section === "musicPlayer") {
    const player = guild.client.kazagumo?.players?.get(guildId);
    if (!player || !player.queue.current) return "> *Aucune lecture en cours.*";
    const track = player.queue.current;
    return [
      `> **En cours** : [${track.title}](${track.uri})`,
      `> **Demandé par** : <@${track.requester?.id || "?"}>`,
      `> **État** : ${player.paused ? "en pause" : "lecture"} · **volume** : ${player.volume}% · **boucle** : ${LOOP_LABELS[player.loop] || "désactivée"}`,
      `> **File d'attente** : ${player.queue.length} titre(s)`,
    ].join("\n");
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
    // Accueil épuré (refonte UX demandée explicitement) : statut + stats
    // serveur toujours visibles (uptime/latence ne révèlent aucun détail
    // d'infrastructure — le diagnostic complet reste réservé au rang sys
    // dans Monitoring), puis au plus DEUX alertes, les plus graves d'abord.
    // Plus d'activité récente ici : elle alourdissait l'accueil pour un
    // usage déjà couvert par Modération > Historique.
    const lines = [];

    const info = computeStatus(guild.client);
    lines.push(`🟢 En ligne — ${formatUptime(info.uptimeMs)} · ${info.ping}ms`);

    const inVoice = guild.voiceStates.cache.filter((v) => v.channelId).size;
    lines.push(`👥 ${guild.memberCount.toLocaleString("fr-FR")} membres · ${guild.channels.cache.size} salons · ${inVoice} en vocal`);

    // Même détection que `&security scan`, sur le cache déjà en mémoire (pas
    // de fetch ici, voir le commentaire dans securityScan.js) : un coup
    // d'œil instantané, pas un audit complet — celui-ci reste dans
    // Sécurité > Vue d'ensemble, jamais dupliqué ici.
    if (can(member, "protection.automod") || can(member, "protection.guard.manage")) {
      const { critical, warnings } = computeSecurityScan(guild);
      lines.push("");
      if (!critical.length && !warnings.length) {
        lines.push("🟢 Tout est en ordre.");
      } else {
        const top = [...critical.map((l) => ["🔴", l]), ...warnings.map((l) => ["🟠", l])].slice(0, 2);
        for (const [emoji, l] of top) lines.push(`${emoji} ${l}`);
      }
    }

    return lines.join("\n");
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
/**
 * Ce qui est réellement DESSINÉ sur le tableau de bord de l'accueil du panel
 * (utils/dashboardImage.js) : une carte par famille, ses rubriques réelles
 * en lignes. Exporté pour que les tests vérifient le contenu de l'image —
 * autrement invérifiable une fois rendue en PNG.
 */

/**
 * Au plus deux alertes de sécurité, les plus graves d'abord — même détection
 * que `&security scan` (utils/securityScan.js), jamais une seconde logique.
 * Réservé à qui peut réellement y remédier.
 */
function alertesSecurite(guild, member) {
  if (!can(member, "protection.automod") && !can(member, "protection.guard.manage")) return [];
  const { critical, warnings } = computeSecurityScan(guild);
  if (!critical.length && !warnings.length) return [{ couleur: "#4ade80", texte: "Tout est en ordre" }];
  return [...critical.map((l) => ({ couleur: "#ff6b6b", texte: l })), ...warnings.map((l) => ({ couleur: "#fbbf24", texte: l }))].slice(0, 2);
}

function buildHomeSpec(guild, member, isOwner = accessStore.isOwner(member.id)) {
  const familles = FAMILIES.filter((f) => f.key !== "accueil" && familySections(f, member, isOwner).length);
  // Statut et alertes sont DESSINÉS ici plutôt qu'écrits sous l'en-tête : une
  // mention citée dans une alerte y sortait en pastille cliquable.
  const info = computeStatus(guild.client);
  const enVocal = guild.voiceStates.cache.filter((v) => v.channelId).size;

  return {
    titre: "Centre de gestion",
    sousTitre: `${member.displayName || member.user?.username || `Membre ${member.id}`} · ${guild.name} · Préfixe : ${getPrefixes(guild.id).musicMod}`,
    banniere: `En ligne ${formatUptime(info.uptimeMs)} · ${info.ping}ms · ${guild.memberCount.toLocaleString("fr-FR")} membres · ${guild.channels.cache.size} salons · ${enVocal} en vocal`,
    alertes: alertesSecurite(guild, member),
    cartes: familles.map((f) => ({
      cle: f.key,
      titre: f.label,
      sousTitre: resumer(f.description),
      couleur: FAMILY_COLORS[f.key] || "#94a3b8",
      items: familySections(f, member, isOwner).map((r) => ({ nom: r.label, description: resumer(r.description) })),
    })),
    pied: "Choisis une famille dans le menu ci-dessous",
    // Chaque carte prend sa hauteur réelle : les familles à une seule
    // rubrique laissaient sinon un grand rectangle vide à côté des autres.
    hauteursLibres: true,
  };
}

/**
 * Ce qui est réellement DESSINÉ sur la rubrique `section` : la même donnée que
 * le corps texte, en structuré. Exporté pour que les tests vérifient le
 * contenu affiché sans avoir à lire une image — même approche que
 * utils/helpPanel.js::buildHelpSpec, et garantie plus solide qu'une
 * expression régulière sur du markdown.
 * @param {string} [corps] sortie de sectionBody(), recalculée si absente
 */
function buildSectionSpec(guild, section, member, state = {}, corps) {
  const meta = SECTIONS.find((s) => s.key === section) || SECTIONS[0];
  return sectionDashboard.enSpec(corps ?? sectionBody(meta.key, guild, member, state), {
    titre: meta.label,
    couleur: FAMILY_COLORS[familyOf(meta.key).key] || "#94a3b8",
    sousTitre: `${member.displayName || member.user?.username || meta.label} · Préfixe : ${getPrefixes(guild.id).musicMod}`,
    guild,
    // Nombre de colonnes laissé à enSpec : il le déduit de la longueur réelle
    // des lignes (deux colonnes seulement si rien n'y serait tronqué).
  });
}

/**
 * @param {{sansImage?: boolean}} [options] `sansImage` force le repli TEXTE —
 *   posé après un envoi refusé par Discord (voir utils/musicCommands.js) :
 *   le salon qui refuse une pièce jointe refusera aussi la suivante.
 */
/**
 * Remplace TOUTES les rangées de boutons d'un écran par UN menu déroulant
 * d'actions. Demande explicite : « je veux plus de boutons, sinon ça fait
 * moche et trop d'options » — la fiche membre en alignait sept, l'écran des
 * permissions cinq.
 *
 * Fait après coup sur le conteneur déjà construit, plutôt que dans chacune
 * des vingt branches de rendu : un seul endroit à maintenir, et une rubrique
 * ajoutée plus tard en bénéficie sans rien changer. La valeur de chaque
 * option EST le customId du bouton d'origine, donc aucun handler n'a besoin
 * d'être réécrit — le routeur réexpédie simplement vers lui.
 *
 * Les boutons DÉSACTIVÉS sont écartés : un menu n'a pas d'option grisée, et
 * proposer une action impossible serait pire que de la masquer.
 */
function regrouperBoutonsEnMenu(container) {
  const enfants = container.components;
  const boutons = [];
  let premiereRangee = -1;

  for (let i = enfants.length - 1; i >= 0; i--) {
    const json = enfants[i].toJSON?.();
    if (json?.type !== 1) continue;
    const composants = json.components || [];
    if (!composants.length || !composants.every((c) => c.type === 2)) continue;
    // Un bouton LIEN ouvre une URL : aucune option de menu ne sait faire ça.
    // Sa rangée est laissée telle quelle, sans quoi le lien disparaîtrait
    // purement et simplement (c'est arrivé au bouton « Ouvrir le lecteur »).
    if (composants.some((b) => !b.custom_id)) continue;
    boutons.unshift(...composants.filter((b) => !b.disabled));
    premiereRangee = i;
    enfants.splice(i, 1);
  }

  if (!boutons.length) return;

  const menu = new StringSelectMenuBuilder()
    .setCustomId(`${ID}:action`)
    .setPlaceholder("Choisir une action")
    .addOptions(
      boutons.slice(0, 25).map((b) => {
        const option = new StringSelectMenuOptionBuilder().setLabel(b.label || "Action").setValue(b.custom_id);
        if (b.emoji) option.setEmoji(b.emoji);
        return option;
      })
    );
  enfants.splice(premiereRangee, 0, new ActionRowBuilder().addComponents(menu));
}

function buildConfigPanel(guild, current = "home", member, state = {}, { sansImage = false } = {}) {
  const isOwner = accessStore.isOwner(member.id);
  const available = sectionsFor(member, isOwner);
  const meta = available.find((s) => s.key === current) || available[0];
  const famille = familyOf(meta.key);
  // Même couleur que utils/helpPanel.js::ACCENT_COLOR (valeur dupliquée
  // volontairement, pas importée : configPanel.js <-> helpPanel.js sont déjà
  // reliés par un require différé dans l'autre sens — un import direct ici
  // fermerait la boucle, voir le commentaire de hasAnyPanelAccessLazy).
  const container = new ContainerBuilder().setAccentColor(0x2c2f5c);
  // Pièces jointes accumulées par l'écran courant (fiche membre en image).
  const fichiers = [];

  const enteteLignes = ["## 🎛️ 「 CENTRE DE GESTION 」", `> <@${member.id}> · Préfixe : \`${getPrefixes(guild.id).musicMod}\``];
  // Sur l'accueil, les cartes annoncent déjà chaque famille : répéter
  // "### Accueil" juste au-dessus n'apporterait rien. Le statut et les
  // alertes ne sont plus écrits ici non plus : en texte, les mentions
  // brutes sortaient en pastilles — un `@everyone` cité dans une alerte de
  // sécurité, notamment. Ils sont désormais DESSINÉS dans l'image de
  // l'accueil, où ils informent sans pouvoir notifier personne.
  if (meta.key !== "home") enteteLignes.push(`### ${famille.emoji} ${meta.label}`);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(enteteLignes.join("\n")));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  if (meta.key === "home") {
    // Accueil = le MÊME tableau de bord en image que l'accueil de &help
    // (utils/dashboardImage.js) : Discord ne sait pas disposer du texte en
    // colonnes, donc la grille est dessinée puis affichée dans le Container
    // Components V2. Les familles, leurs rubriques et leurs droits restent
    // ceux du panel réel — aucune fonction inventée, seulement une mise en
    // page.
    const homeSpec = buildHomeSpec(guild, member, isOwner);
    // `null` = le dessin a échoué (rendreEnCache journalise le motif) : on
    // repasse sur la MÊME grille en texte plutôt que de laisser &panel sans
    // rien afficher. Le menu de navigation, lui, ne dépend pas de l'image.
    const png = sansImage ? null : rendreEnCache(homeSpec);
    if (png) {
      container.addMediaGalleryComponents(
        new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${NOM_IMAGE_PANEL}`))
      );
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(enTexte(homeSpec)));
    }
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(buildNav(meta.key, member, isOwner)));
    return {
      flags: MessageFlags.IsComponentsV2,
      components: [container],
      // Sans image, PAS de `files` : un MediaGallery qui pointe sur une pièce
      // jointe absente ferait refuser tout le message par Discord.
      ...(png ? { files: [new AttachmentBuilder(png, { name: NOM_IMAGE_PANEL })] } : {}),
    };
  }

  // TOUTES les rubriques sont dessinées : demande explicite d'un bot "rempli
  // de tableaux de bord". Le contenu reste EXACTEMENT celui de sectionBody —
  // une seule source de vérité, la même que lisent les commandes texte
  // équivalentes — simplement converti en grille de cartes
  // (utils/sectionDashboard.js) au lieu d'être empilé en lignes de citation.
  const corps = sectionBody(meta.key, guild, member, state);
  const specRubrique = buildSectionSpec(guild, meta.key, member, state, corps);
  const pngRubrique = sansImage ? null : rendreEnCache(specRubrique);
  if (pngRubrique) {
    fichiers.push(new AttachmentBuilder(pngRubrique, { name: NOM_IMAGE_RUBRIQUE }));
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(`attachment://${NOM_IMAGE_RUBRIQUE}`))
    );
  } else {
    // Le corps d'origine, pas enTexte(spec) : ici le texte Discord est
    // MEILLEUR que sa transposition (il résout les mentions et les dates
    // tout seul). Le repli rend donc la rubrique telle qu'elle était.
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(corps));
  }
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
          new ButtonBuilder().setCustomId(`${ID}:rolecreate`).setLabel("Créer un rôle").setStyle(ButtonStyle.Success).setEmoji(EMOJI.PENCIL)
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
          new ButtonBuilder()
            .setCustomId(`${ID}:rolemembers:${state.permissionsRoleId}`)
            .setLabel("Voir les membres")
            .setStyle(ButtonStyle.Secondary)
            .setEmoji(EMOJI.MEMBERS)
        );
      }
      if (peutModifier) {
        boutons.push(
          exclusif
            ? new ButtonBuilder()
                .setCustomId(`${ID}:roleexclusiveoff:${state.permissionsRoleId}`)
                .setLabel("Retirer de l'exclusif")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(EMOJI.CROSS)
            : new ButtonBuilder()
                .setCustomId(`${ID}:roleexclusive:${state.permissionsRoleId}`)
                .setLabel("Ajouter à l'exclusif")
                .setStyle(ButtonStyle.Secondary)
                .setEmoji(EMOJI.CHECK)
        );
        boutons.push(
          new ButtonBuilder()
            .setCustomId(`${ID}:roledelete:${state.permissionsRoleId}`)
            .setLabel("Supprimer ce rôle")
            .setStyle(ButtonStyle.Danger)
            .setEmoji(EMOJI.DELETE)
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
        new ButtonBuilder().setCustomId(`${ID}:giveawaystart`).setLabel("Démarrer un giveaway").setStyle(ButtonStyle.Success).setEmoji(EMOJI.CROWN)
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
            new ButtonBuilder()
              .setCustomId(`${ID}:giveawayend:${state.giveawaySelected}`)
              .setLabel("Terminer maintenant")
              .setStyle(ButtonStyle.Danger)
              .setEmoji(EMOJI.LOCK),
            new ButtonBuilder()
              .setCustomId(`${ID}:giveawayreroll:${state.giveawaySelected}`)
              .setLabel("Retirer un gagnant (reroll)")
              .setStyle(ButtonStyle.Secondary)
              .setEmoji(EMOJI.ARROW)
          )
        );
      }
    }
  } else if (meta.key === "embedBuilder") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:embedbuild`).setLabel("Construire un embed").setStyle(ButtonStyle.Secondary).setEmoji(EMOJI.PENCIL)
      )
    );
  } else if (meta.key === "polls") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:pollstart`).setLabel("Créer un sondage").setStyle(ButtonStyle.Secondary).setEmoji(EMOJI.PENCIL)
      )
    );
  } else if (meta.key === "musicPlayer") {
    const player = guild.client.kazagumo?.players?.get(guild.id);
    const npMessage = guild.client.nowPlayingMessages?.get(guild.id);
    const boutons = [];
    // Lien direct vers le VRAI panneau de lecture (déjà suivi/rafraîchi par
    // utils/musicPlayer.js) plutôt qu'une copie de ses boutons ici : les
    // customId music_* sont routés par index.js en supposant qu'ils vivent
    // sur CE message précis (il l'édite en retour) — les dupliquer dans le
    // panel désynchroniserait les deux affichages.
    if (player?.queue?.current && npMessage) {
      boutons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Ouvrir le lecteur").setURL(npMessage.url).setEmoji(EMOJI.VOICE));
    }
    boutons.push(new ButtonBuilder().setCustomId(`${ID}:musicfavlist`).setLabel("Mes favoris").setStyle(ButtonStyle.Secondary).setEmoji(EMOJI.CROWN));
    container.addActionRowComponents(new ActionRowBuilder().addComponents(...boutons));
  } else if (meta.key === "backups") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:backupsavebtn`).setLabel("Sauvegarder ce serveur").setStyle(ButtonStyle.Success).setEmoji(EMOJI.CHECK)
      )
    );
    const saved = backupStore.listBackups().map((b) => b.name);
    const all = [...Object.keys(PRESET_BACKUPS), ...saved];
    if (all.length) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${ID}:backuppick`)
            .setPlaceholder("Choisir une sauvegarde")
            .addOptions(
              all.slice(0, 25).map((name) =>
                new StringSelectMenuOptionBuilder().setLabel(name).setValue(name).setDefault(name === state.backupSelected)
              )
            )
        )
      );
      if (state.backupSelected && all.includes(state.backupSelected)) {
        const isPresetOnly = PRESET_BACKUPS[state.backupSelected.toLowerCase()] && !backupStore.getBackup(state.backupSelected);
        const boutons = [
          new ButtonBuilder()
            .setCustomId(`${ID}:backuprestore:${state.backupSelected}`)
            .setLabel("Restaurer (double confirmation)")
            .setStyle(ButtonStyle.Danger)
            .setEmoji(EMOJI.ARROW),
        ];
        if (!isPresetOnly) {
          boutons.push(
            new ButtonBuilder()
              .setCustomId(`${ID}:backupdelete:${state.backupSelected}`)
              .setLabel("Supprimer")
              .setStyle(ButtonStyle.Secondary)
              .setEmoji(EMOJI.DELETE)
          );
        }
        container.addActionRowComponents(new ActionRowBuilder().addComponents(...boutons));
      }
    }
  } else if (meta.key === "botProfile") {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${ID}:botstatus`)
          .setPlaceholder("Changer le statut")
          .addOptions(
            Object.entries(STATUS_LABELS).map(([value, label]) =>
              new StringSelectMenuOptionBuilder().setLabel(label).setValue(value).setDefault(value === botProfileStore.getConfig().status)
            )
          )
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${ID}:botnamebtn`).setLabel("Changer le nom").setStyle(ButtonStyle.Secondary).setEmoji(EMOJI.PENCIL)
      )
    );
  }

  // Dernière étape du rendu : les boutons d'action deviennent un seul menu.
  regrouperBoutonsEnMenu(container);

  return { flags: MessageFlags.IsComponentsV2, components: [container], ...(fichiers.length ? { files: fichiers } : {}) };
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
async function handleConfigInteraction(interaction, customIdImpose) {
  // `customIdImpose` sert au menu d'actions : la valeur choisie EST le
  // customId du bouton d'origine, et on réexpédie vers son handler sans avoir
  // à cloner l'interaction (un clone casserait les méthodes de discord.js).
  const identifiant = customIdImpose || interaction.customId;
  const [, action, extra, extra2] = identifiant.split(":");
  const member = interaction.member;

  if (!hasAnyPanelAccess(member)) {
    return interaction.reply({ content: "Tu n'as pas accès à ce panneau.", flags: MessageFlags.Ephemeral });
  }

  // Menu d'actions : la valeur choisie est le customId du bouton d'origine.
  // Une seule redirection possible — la valeur ne peut pas être un autre
  // "cfg:action", donc pas de récursion sans fin.
  if (action === "action") {
    const choisi = interaction.values?.[0];
    if (!choisi || choisi.startsWith(`${ID}:action`)) return undefined;
    return handleConfigInteraction(interaction, choisi);
  }

  const guild = interaction.guild;
  const guildId = guild.id;
  const isOwner = accessStore.isOwner(member.id);

  // `attachments: []` à CHAQUE édition : le panel est un message unique édité
  // en place, et certains écrans portent une image (tableau de bord de
  // l'accueil, fiche membre). Sans ce champ, Discord conserve les pièces
  // jointes précédentes et le message accumule une image de plus à chaque
  // clic — y compris en revenant sur un écran qui n'en a aucune.
  // Une édition refusée (pièce jointe interdite dans le salon, écran à image)
  // laissait le clic sans réponse — « Échec de l'interaction », panel figé sur
  // l'écran précédent. On rejoue alors le même écran en texte, comme le fait
  // le premier envoi (utils/musicCommands.js::repondreAvecTableauDeBord).
  const editer = (section, state, sansImage) =>
    interaction.update({ ...buildConfigPanel(guild, section, member, state, { sansImage }), attachments: [] });
  const goto = (section, state) =>
    editer(section, state, false).catch((err) => {
      console.error("[configPanel] interaction.update a échoué :", err);
      return editer(section, state, true).catch((err2) => console.error("[configPanel] repli texte refusé lui aussi :", err2));
    });

  if (action === "nav") {
    // Le bouton de navigation donne une famille (clé dans le customId,
    // "cfg:nav:<clé>" — plus un menu déroulant) : on ouvre sa première
    // rubrique accessible, celle qui a le plus de chances d'être celle
    // qu'on cherche.
    const famille = FAMILIES.find((f) => f.key === (interaction.values?.[0] || extra));
    const rubriques = famille ? familySections(famille, member, isOwner) : [];
    return goto(rubriques[0]?.key || "home");
  }

  if (action === "subnav") {
    return goto(interaction.values[0]);
  }

  if (action === "permrole") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return goto("permissions", { permissionsRoleId: interaction.values[0] });
  }

  if (action === "permshowcmds" || action === "permhidecmds") {
    if (!can(member, "panel.permissions.manage") && !can(member, "panel.roles.manage")) {
      return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    }
    return goto("permissions", { permissionsRoleId: extra, permissionsShowCommands: action === "permshowcmds" });
  }

  // Réutilise TEL QUEL &rolemembers (utils/utilityCommands.js), jamais
  // exposé dans le panel jusqu'ici — même liste paginée qu'en tapant la
  // commande, juste ouverte depuis la fiche du rôle.
  if (action === "rolemembers") {
    if (!can(member, "server.members.list")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
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
    if (!can(member, "server.giveaways.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return interaction.reply(buildFormCard("giveaway_start", member));
  }

  if (action === "giveawaypick") {
    if (!can(member, "server.giveaways.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return goto("giveaways", { giveawaySelected: interaction.values[0] || null });
  }

  if (action === "giveawayend" || action === "giveawayreroll") {
    if (!can(member, "server.giveaways.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
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
    if (!can(member, "server.polls.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return interaction.reply(buildFormCard("poll_create", member));
  }

  // Musique : mêmes deux lignes que le bouton "Mes favoris" du panneau de
  // lecture (index.js) — pas une deuxième implémentation.
  if (action === "musicfavlist") {
    const { main } = getPrefixes(guildId);
    const panel = buildFavoritesPanel(interaction.user.id, main);
    if (!panel) return interaction.reply({ content: "Tu n'as encore aucun favori.", flags: MessageFlags.Ephemeral });
    return interaction.reply({ ...panel, flags: panel.flags | MessageFlags.Ephemeral });
  }

  // Sauvegardes : réutilise TEL QUEL &backup (utils/serverBackup.js) — un
  // seul dispatcher pour créer/supprimer/restaurer, jamais une deuxième
  // implémentation. `messageFromInteraction` sert d'accusé de réception
  // (sa .reply() = interaction.reply(), même mécanisme que rolecreate un peu
  // plus haut) : le message de confirmation vient donc directement de
  // &backup lui-même. Restaurer passe doubleConfirm:true — amélioration
  // demandée explicitement pour le panel, où un clic est plus facile qu'en
  // tapant la commande.
  if (action === "backupsavebtn") {
    if (!can(member, "sys")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    if (interaction.isModalSubmit()) {
      const name = interaction.fields.getTextInputValue("name").trim();
      if (!name) return interaction.reply({ content: "Nom vide, rien n'a été sauvegardé.", flags: MessageFlags.Ephemeral });
      await backup(interaction.client, messageFromInteraction(interaction), [name]);
      return;
    }
    const modal = new ModalBuilder().setCustomId(`${ID}:backupsavebtn`).setTitle("Sauvegarder ce serveur");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("name").setLabel("Nom de la sauvegarde").setStyle(TextInputStyle.Short).setMaxLength(50).setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "backuppick") {
    if (!can(member, "sys")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return goto("backups", { backupSelected: interaction.values[0] || null });
  }

  if (action === "backupdelete") {
    if (!can(member, "sys")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    await backup(interaction.client, messageFromInteraction(interaction), ["delete", extra]);
    return;
  }

  if (action === "backuprestore") {
    if (!can(member, "sys")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    await backup(interaction.client, messageFromInteraction(interaction), ["load", extra], { doubleConfirm: true });
    return;
  }

  // Profil du bot : réutilise TEL QUEL utils/botProfileCommands.js — même
  // remarque que ci-dessus, aucune deuxième implémentation.
  if (action === "botstatus") {
    if (!can(member, "sys")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const fn = botProfileHandlers[interaction.values[0]];
    if (!fn) return;
    await fn(interaction.client, messageFromInteraction(interaction));
    return;
  }

  if (action === "botnamebtn") {
    if (!can(member, "sys")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    if (interaction.isModalSubmit()) {
      const name = interaction.fields.getTextInputValue("name").trim();
      if (!name) return interaction.reply({ content: "Nom vide, rien n'a changé.", flags: MessageFlags.Ephemeral });
      await botProfileHandlers.set(interaction.client, messageFromInteraction(interaction), ["name", name]);
      return;
    }
    const modal = new ModalBuilder().setCustomId(`${ID}:botnamebtn`).setTitle("Changer le nom du bot");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("name").setLabel("Nouveau nom").setStyle(TextInputStyle.Short).setMaxLength(32).setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  // Création/suppression de rôle depuis le panel : réutilise TEL QUEL
  // utils/serverAdminCommands.js::roleAdmin (même vérif de droits, même
  // journal, même confirmation avant suppression) via un objet "message"
  // minimal — pas de logique dupliquée entre &role create/delete et ces
  // boutons.
  if (action === "rolecreate") {
    if (!can(member, "server.roles.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
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
    if (!can(member, "server.roles.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    await roleAdmin(interaction.client, messageFromInteraction(interaction), ["delete", extra]);
    return;
  }

  // "Exclusif" : simple étiquette côté panel, aucun effet sur le calcul des
  // permissions (voir utils/permissions/store.js).
  if (action === "roleexclusive" || action === "roleexclusiveoff") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    permStore.setRoleExclusive(guildId, extra, action === "roleexclusive");
    return goto("permissions", { permissionsRoleId: extra });
  }

  if (action === "permcat") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return goto("permissions", { permissionsRoleId: extra, permissionsCategory: interaction.values[0] });
  }

  if (action === "permkeys") {
    if (!can(member, "panel.permissions.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
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
    if (!can(member, "logs.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return goto("logs", { logsCategory: interaction.values[0] });
  }

  if (action === "logchannel") {
    if (!can(member, "logs.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    setLogChannelId(guildId, extra, interaction.values[0] || null);
    return goto("logs", { logsCategory: extra });
  }

  if (action === "logauto") {
    if (!can(member, "logs.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
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
    if (!can(member, "logs.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
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
  // MODÉRATION RETIRÉE DU PANEL, volontairement : plus de recherche de membre,
  // plus de boutons Warn/Timeout/Kick/Ban ni d'ajout de rôle ici. Le panel
  // sert à la sécurité, aux outils et à la gestion du serveur ; sanctionner
  // ou donner un rôle se fait par commande, avec une mention ou un
  // identifiant. L'historique reste consultable sous Monitoring — c'est de la
  // consultation, pas une action sur un membre.

  // Recherche d'historique : cible/modérateur se choisissent désormais via
  // UserSelectMenu natif (chips + avatars) au lieu d'un ID/mention tapé à la
  // main — un Modal Discord ne pouvant pas contenir de select menu, le
  // bouton "Rechercher" ouvre maintenant une carte dans le panel lui-même
  // plutôt qu'un Modal direct. Le type d'événement/l'ID précis restent du
  // texte libre (aucun équivalent natif) via un Modal réduit, ouvert depuis
  // cette carte et qui porte cible/modérateur dans son propre customId pour
  // ne pas les perdre.
  if (action === "history" && extra === "search") {
    if (!can(member, "logs.view")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return goto("history", { historySearchOpen: true });
  }

  if (action === "historytarget" || action === "historymoderator") {
    if (!can(member, "logs.view")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const other = extra !== "_" ? extra : null;
    const chosen = interaction.values[0] || null;
    return goto("history", {
      historySearchOpen: true,
      historySearchTarget: action === "historytarget" ? chosen : other,
      historySearchModerator: action === "historymoderator" ? chosen : other,
    });
  }

  if (action === "historytextopen") {
    if (!can(member, "logs.view")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
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
    if (!can(member, "logs.view")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return handleHistorySearchModal(interaction, {
      targetId: extra !== "_" ? extra : null,
      moderatorId: extra2 !== "_" ? extra2 : null,
    });
  }

  if (action === "historyrun") {
    if (!can(member, "logs.view")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
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
    if (!can(member, requiredPerm)) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });

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
    if (!can(member, "protection.whitelist")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const userId = interaction.values[0];
    if (action === "wladd") automod.addToWhitelist(guildId, "users", userId);
    else automod.removeFromWhitelist(guildId, "users", userId);
    return goto("protection");
  }

  if (action === "badwords" && extra === "del") {
    if (!can(member, "protection.automod")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    badWords.removeWord(guildId, interaction.values[0]);
    return goto("protection");
  }

  if (action === "badwords" && extra === "add") {
    if (!can(member, "protection.automod")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
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
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
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
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    return goto("guard", { guardAction: "guard_pick", guardKey: interaction.values[0] });
  }

  if (action === "guardtoggle") {
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    guardConfig.toggleGuard(guildId, extra);
    return goto("guard", { guardAction: "guard_pick", guardKey: extra });
  }

  if (action === "guardwladd" || action === "guardwldel") {
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const userId = interaction.values[0];
    if (action === "guardwladd") guardWhitelist.add(guildId, "users", userId);
    else guardWhitelist.remove(guildId, "users", userId);
    return goto("guard");
  }

  if (action === "guardwlroleadd" || action === "guardwlroledel") {
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    const roleId = interaction.values[0];
    if (action === "guardwlroleadd") guardWhitelist.add(guildId, "roles", roleId);
    else guardWhitelist.remove(guildId, "roles", roleId);
    return goto("guard");
  }

  if (action === "guardping") {
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
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
    if (!can(member, "protection.guard.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
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
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    welcomeStore.setChannel(guildId, interaction.values[0] || null);
    return goto("welcome");
  }

  if (action === "welcomedelete") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    welcomeStore.setAutoDelete(guildId, parseInt(interaction.values[0], 10) || 0);
    return goto("welcome");
  }

  if (action === "welcomedel") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    welcomeStore.removeMessage(guildId, parseInt(interaction.values[0], 10));
    return goto("welcome");
  }

  if (action === "welcomeadd") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
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
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    leaveStore.setChannel(guildId, interaction.values[0] || null);
    return goto("leave");
  }

  if (action === "leavedelete") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    leaveStore.setAutoDelete(guildId, parseInt(interaction.values[0], 10) || 0);
    return goto("leave");
  }

  if (action === "leavedel") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    leaveStore.removeMessage(guildId, parseInt(interaction.values[0], 10));
    return goto("leave");
  }

  if (action === "leaveadd") {
    if (!can(member, "server.welcome.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
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
    if (!can(member, "members.autorole.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    autoroleStore.setRoleIds(guildId, interaction.values);
    return goto("autorole");
  }

  if (action === "verifyrole") {
    if (!can(member, "members.verification.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    verificationStore.setRole(guildId, interaction.values[0] || null);
    return goto("verification");
  }

  if (action === "verifypost") {
    if (!can(member, "members.verification.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
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
    if (!can(member, "sys")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
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
    if (!can(member, "protection.automod")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    muteStore.setMuteRoleId(guildId, interaction.values[0] || null);
    return goto("mute");
  }

  if (action === "ticketstaff") {
    if (!can(member, "server.tickets.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    ticketStore.setStaffRole(guildId, interaction.values[0] || null);
    return goto("tickets");
  }

  if (action === "voicehubchannel") {
    if (!can(member, "server.voice.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    voiceChannels.setHub(guildId, interaction.values[0] || null);
    return goto("voice");
  }

  if (action === "voicespawncategory") {
    if (!can(member, "server.voice.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    voiceChannels.setSpawnCategory(guildId, interaction.values[0] || null);
    return goto("voice");
  }

  if (action === "voicepanelchannel") {
    if (!can(member, "server.voice.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    voiceChannels.setPanelChannel(guildId, interaction.values[0] || null);
    return goto("voice");
  }

  if (action === "voicehubsetup") {
    if (!can(member, "server.voice.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
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
    if (!can(member, "server.voice.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
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
    if (!can(member, "server.voice.manage")) return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });

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
    return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
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

module.exports = {
  buildHomeSpec,
  buildConfigPanel, buildSectionSpec, handleConfigInteraction, handleHistorySearchModal, hasAnyPanelAccess, ID, SECTIONS };
