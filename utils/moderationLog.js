const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  AuditLogEvent,
  ChannelType,
  PermissionsBitField,
} = require("discord.js");
const { getLogChannelId } = require("./modLogStore");
const historyStore = require("./moderationHistoryStore");
const voiceChannels = require("./voiceChannels");

// Toute action qui compte comme "modération" au sens large : ce que fait ce
// bot (&ban/&unban/&banall/&kick/...), ce que fait le CrowBot du serveur, et
// ce que fait n'importe quel modérateur humain — le journal d'audit Discord
// retient l'exécuteur réel quel que soit le bot ou la personne qui a agi,
// donc ce seul mécanisme couvre les trois sans avoir à instrumenter chaque
// commande ni à lire quoi que ce soit chez le CrowBot.
//
// IMPORTANT — actions de CE bot : Discord attribue toute action REST à
// l'exécuteur réel (le compte qui a appelé l'API), qui pour une commande de
// CE bot est le compte DU BOT, pas la personne qui a tapé la commande. Ce
// relais ignore donc systématiquement les entrées dont l'exécuteur est le
// bot lui-même (voir relayAuditLogEntry) : ces actions sont déjà journalisées
// avec le VRAI modérateur par utils/moderation/actions.js, qui connaît
// message.author/interaction.user directement.
//
// `category` route vers utils/modLogStore.js (un salon par catégorie).
// `describe` retourne { title, fields } — titre en gras, puis une ligne par
// champ ("**Label :** valeur"), même présentation que utils/moderation/
// actions.js::report() pour les actions de CE bot : un seul format de carte
// de log dans tout le bot.
// `history` (optionnel) : quand présent, l'entrée est AUSSI ajoutée à
// utils/moderationHistoryStore.js (recherche via &modlogs/panel) — réservé
// aux actions qui ciblent un membre de façon disciplinaire ; le bruit
// purement "sécurité serveur" (salon/rôle/webhook créés...) reste dans le
// salon de logs sans polluer l'historique de modération.
const HANDLERS = {
  [AuditLogEvent.MemberBanAdd]: {
    category: "moderation",
    describe: (e) => ({ title: "Bannissement", fields: [targetField(e)] }),
    history: (e) => ({ action: "ban", targetId: e.targetId, targetTag: e.target?.tag || null }),
  },
  [AuditLogEvent.MemberBanRemove]: {
    category: "moderation",
    describe: (e) => ({ title: "Débannissement", fields: [targetField(e)] }),
    history: (e) => ({ action: "unban", targetId: e.targetId, targetTag: e.target?.tag || null }),
  },
  [AuditLogEvent.MemberKick]: {
    category: "moderation",
    describe: (e) => ({ title: "Expulsion", fields: [targetField(e)] }),
    history: (e) => ({ action: "kick", targetId: e.targetId, targetTag: e.target?.tag || null }),
  },
  [AuditLogEvent.MemberUpdate]: {
    category: "moderation",
    // Un MemberUpdate couvre aussi les surnoms et la sourdine vocale : seuls
    // le timeout et le changement de pseudo nous intéressent ici.
    describe: (e) => {
      const timeout = e.changes.find((c) => c.key === "communication_disabled_until");
      if (timeout) {
        if (timeout.new) {
          const until = Math.floor(new Date(timeout.new).getTime() / 1000);
          return { title: "Timeout", fields: [targetField(e), { label: "Jusqu'à", value: `<t:${until}:f>` }] };
        }
        return { title: "Fin de timeout", fields: [targetField(e)] };
      }
      const nick = e.changes.find((c) => c.key === "nick");
      if (nick) {
        return { title: "Pseudo modifié", fields: [targetField(e), { label: "Nouveau pseudo", value: nick.new || "*retiré*" }] };
      }
      return null;
    },
    history: (e) => {
      const timeout = e.changes.find((c) => c.key === "communication_disabled_until");
      if (timeout) {
        return {
          action: timeout.new ? "timeout" : "untimeout",
          targetId: e.targetId,
          targetTag: e.target?.tag || null,
          extra: timeout.new ? { until: timeout.new } : null,
        };
      }
      const nick = e.changes.find((c) => c.key === "nick");
      if (nick) return { action: "nick", targetId: e.targetId, targetTag: e.target?.tag || null, extra: { to: nick.new || null } };
      return null;
    },
  },
  [AuditLogEvent.MemberRoleUpdate]: {
    category: "members",
    describe: (e) => {
      const added = e.changes.find((c) => c.key === "$add")?.new;
      const removed = e.changes.find((c) => c.key === "$remove")?.new;
      const fields = [targetField(e)];
      if (added?.length) fields.push({ label: "Rôle(s) ajouté(s)", value: added.map((r) => `${r.name} (${r.id})`).join("\n") });
      if (removed?.length) fields.push({ label: "Rôle(s) retiré(s)", value: removed.map((r) => `${r.name} (${r.id})`).join("\n") });
      if (fields.length === 1) return null;
      return { title: "Modification des rôles", fields };
    },
    history: (e) => {
      const added = e.changes.find((c) => c.key === "$add")?.new || [];
      const removed = e.changes.find((c) => c.key === "$remove")?.new || [];
      if (!added.length && !removed.length) return null;
      return {
        action: "role",
        targetId: e.targetId,
        targetTag: e.target?.tag || null,
        extra: { added: added.map((r) => r.id), removed: removed.map((r) => r.id) },
      };
    },
  },
  [AuditLogEvent.ChannelCreate]: {
    category: "channels",
    describe: (e) => ({ title: "Salon créé", fields: [channelField(e), ...channelDetailFields(e.target)] }),
  },
  [AuditLogEvent.ChannelDelete]: {
    category: "channels",
    describe: (e) => ({ title: "Salon supprimé", fields: [channelField(e), ...channelDetailFields(e.target)] }),
  },
  [AuditLogEvent.ChannelUpdate]: {
    category: "channels",
    describe: (e) => {
      const fields = [channelField(e)];
      const name = e.changes.find((c) => c.key === "name");
      if (name && name.old !== name.new) fields.push({ label: "Nom", value: `${name.old} → ${name.new}` });
      const topic = e.changes.find((c) => c.key === "topic");
      if (topic && topic.old !== topic.new) {
        fields.push({ label: "Topic", value: `${topic.old || "*aucun*"} → ${topic.new || "*aucun*"}` });
      }
      const nsfw = e.changes.find((c) => c.key === "nsfw");
      if (nsfw) fields.push({ label: "NSFW", value: boolLabel(nsfw.new) });
      const slowmode = e.changes.find((c) => c.key === "rate_limit_per_user");
      if (slowmode) fields.push({ label: "Mode lent", value: `${Number(slowmode.new || 0)}s` });
      if (fields.length === 1) return null; // rien d'intéressant pour la modération (position, permissions...)
      return { title: "Salon mis à jour", fields };
    },
    history: (e) => {
      const slowmode = e.changes.find((c) => c.key === "rate_limit_per_user");
      if (!slowmode) return null;
      return { action: "slowmode", targetId: e.targetId, targetTag: null, extra: { seconds: Number(slowmode.new || 0) } };
    },
  },
  [AuditLogEvent.ChannelOverwriteCreate]: {
    category: "channels",
    describe: (e) => overwriteDescribe(e, "créée"),
  },
  [AuditLogEvent.ChannelOverwriteUpdate]: {
    category: "channels",
    describe: (e) => overwriteDescribe(e, "modifiée"),
  },
  [AuditLogEvent.RoleCreate]: {
    category: "roles",
    describe: (e) => ({ title: "Création de rôle", fields: [targetField(e, "Rôle créé"), ...roleDetailFields(e.target)] }),
  },
  [AuditLogEvent.RoleDelete]: {
    category: "roles",
    describe: (e) => ({ title: "Suppression de rôle", fields: [targetField(e, "Rôle supprimé"), ...roleDetailFields(e.target)] }),
  },
  [AuditLogEvent.RoleUpdate]: {
    category: "roles",
    // Nom, couleur, permission Administrateur : le reste (position,
    // mentionable, hoist...) n'est pas assez significatif pour justifier une
    // entrée de log à chaque fois.
    describe: (e) => {
      const fields = [targetField(e, "Rôle mis à jour")];
      const name = e.changes.find((c) => c.key === "name");
      if (name && name.old !== name.new) fields.push({ label: "Nom", value: `${name.old} → ${name.new}` });
      const color = e.changes.find((c) => c.key === "color");
      if (color && color.old !== color.new) {
        const hex = (v) => `#${(v || 0).toString(16).padStart(6, "0")}`;
        fields.push({ label: "Couleur", value: `${hex(color.old)} → ${hex(color.new)}` });
      }
      const perms = e.changes.find((c) => c.key === "permissions");
      if (perms) {
        const before = new PermissionsBitField(BigInt(perms.old || 0));
        const after = new PermissionsBitField(BigInt(perms.new || 0));
        const gained = before.has(PermissionsBitField.Flags.Administrator) !== after.has(PermissionsBitField.Flags.Administrator);
        if (gained) fields.push({ label: "Administrateur", value: after.has(PermissionsBitField.Flags.Administrator) ? "donné" : "retiré" });
      }
      if (fields.length === 1) return null;
      return { title: "Rôle mis à jour", fields };
    },
  },
  // Manquait entièrement : "Serveur" (utils/modLogStore.js) n'était alimenté
  // QUE par une poignée de commandes de CE bot (dero, tickets, &unbanall...),
  // jamais par un vrai changement du serveur LUI-MÊME (nom, icône, niveau de
  // vérification...) — d'où l'impression que cette catégorie ne "servait à
  // rien", contrairement aux autres qui ont toutes leur relais d'audit
  // automatique. Seuls les changements notables sont montrés (position dans
  // la liste, mfa_level, owner_id... n'ont pas leur place ici).
  [AuditLogEvent.GuildUpdate]: {
    category: "server",
    describe: (e) => {
      const fields = [];
      const name = e.changes.find((c) => c.key === "name");
      if (name && name.old !== name.new) fields.push({ label: "Nom", value: `${name.old} → ${name.new}` });
      const icon = e.changes.find((c) => c.key === "icon_hash");
      if (icon) fields.push({ label: "Icône", value: icon.new ? "changée" : "retirée" });
      const banner = e.changes.find((c) => c.key === "banner_hash");
      if (banner) fields.push({ label: "Bannière", value: banner.new ? "changée" : "retirée" });
      const verif = e.changes.find((c) => c.key === "verification_level");
      if (verif) fields.push({ label: "Niveau de vérification", value: VERIFICATION_LEVEL_LABELS[verif.new] ?? String(verif.new) });
      const filter = e.changes.find((c) => c.key === "explicit_content_filter");
      if (filter) fields.push({ label: "Filtre de contenu explicite", value: EXPLICIT_CONTENT_FILTER_LABELS[filter.new] ?? String(filter.new) });
      const afkChannel = e.changes.find((c) => c.key === "afk_channel_id");
      if (afkChannel) fields.push({ label: "Salon AFK", value: afkChannel.new ? `<#${afkChannel.new}>` : "*aucun*" });
      const afkTimeout = e.changes.find((c) => c.key === "afk_timeout");
      if (afkTimeout) fields.push({ label: "Délai AFK", value: `${afkTimeout.new}s` });
      const systemChannel = e.changes.find((c) => c.key === "system_channel_id");
      if (systemChannel) fields.push({ label: "Salon système", value: systemChannel.new ? `<#${systemChannel.new}>` : "*aucun*" });
      const vanity = e.changes.find((c) => c.key === "vanity_url_code");
      if (vanity && vanity.old !== vanity.new) fields.push({ label: "Lien personnalisé", value: vanity.new ? `discord.gg/${vanity.new}` : "*retiré*" });
      if (!fields.length) return null;
      return { title: "Paramètres du serveur modifiés", fields };
    },
  },

  [AuditLogEvent.WebhookCreate]: {
    category: "channels",
    describe: (e) => ({ title: "Webhook créé", fields: [targetField(e)] }),
  },
  [AuditLogEvent.MessageBulkDelete]: {
    category: "moderation",
    describe: (e) => ({
      title: "Suppression de messages",
      fields: [
        { label: "Salon", value: channelLabel(e) },
        { label: "Nombre", value: String(e.extra?.count ?? "?") },
      ],
    }),
    // Pas d'écriture d'historique ici : &clear (utils/moderation/actions.js)
    // enregistre déjà une entrée plus riche (avec la cible) au moment de
    // l'action — un doublon générique n'ajouterait rien.
  },
  [AuditLogEvent.BotAdd]: {
    category: "bots",
    describe: (e) => ({ title: "Bot ajouté", fields: [targetField(e, "Bot")] }),
  },
  [AuditLogEvent.MemberDisconnect]: {
    category: "members",
    describe: (e) => ({ title: "Déconnexion vocale forcée", fields: [{ label: "Nombre", value: String(e.extra?.count ?? "?") }] }),
  },
};

const boolLabel = (v) => (v ? "Oui" : "Non");

const CHANNEL_TYPE_LABELS = {
  [ChannelType.GuildText]: "Textuel",
  [ChannelType.GuildVoice]: "Vocal",
  [ChannelType.GuildCategory]: "Catégorie",
  [ChannelType.GuildAnnouncement]: "Annonces",
  [ChannelType.GuildStageVoice]: "Conférence",
  [ChannelType.GuildForum]: "Forum",
};

// Discord expose ces deux réglages comme un simple entier (0-4 / 0-2) —
// mêmes libellés que l'interface Discord elle-même.
const VERIFICATION_LEVEL_LABELS = ["Aucune", "Faible", "Moyenne", "Haute", "Très haute (téléphone requis)"];
const EXPLICIT_CONTENT_FILTER_LABELS = ["Désactivé", "Membres sans rôle", "Tous les membres"];

/** Champ générique pour une cible : mention Discord (ne ping jamais, voir index.js) + ID. */
function targetField(entry, label = "Cible") {
  const t = entry.target;
  const id = t?.id ?? entry.targetId;
  if (!id) return { label, value: "cible inconnue" };
  if (t?.tag) return { label, value: `<@${id}> (${id})` };
  if (t?.name) return { label, value: `${t.name} (${id})` };
  return { label, value: `\`${id}\`` };
}

function channelField(entry) {
  const id = entry.targetId;
  if (!id) return { label: "Salon", value: "salon inconnu" };
  const name = entry.target?.name;
  return { label: "Salon", value: name ? `<#${id}> ${name} (${id})` : `<#${id}> (${id})` };
}

/** Détails d'un salon (création/suppression) : disponibles tant que `channel` est un objet résolu. */
function channelDetailFields(channel) {
  if (!channel || typeof channel !== "object") return [];
  const fields = [{ label: "Type", value: CHANNEL_TYPE_LABELS[channel.type] || "Inconnu" }];
  if (channel.parent?.name) fields.push({ label: "Catégorie", value: `${channel.parent.name} (${channel.parent.id})` });
  if ("nsfw" in channel) fields.push({ label: "NSFW", value: boolLabel(channel.nsfw) });
  if ("topic" in channel) fields.push({ label: "Topic", value: channel.topic || "Aucun topic" });
  return fields;
}

/** Détails d'un rôle (création/suppression) : disponibles tant que `role` est un objet résolu. */
function roleDetailFields(role) {
  if (!role || typeof role !== "object") return [];
  return [
    { label: "Couleur", value: role.hexColor || "#000000" },
    { label: "Mentionnable", value: boolLabel(role.mentionable) },
    { label: "Affiché séparément", value: boolLabel(role.hoist) },
    { label: "Position", value: String(role.position ?? "?") },
  ];
}

function channelLabel(entry) {
  const c = entry.extra?.channel;
  return c?.id ? `<#${c.id}> (${c.id})` : "un salon";
}

function overwriteDescribe(entry, verb) {
  const denySend = entry.changes.some((c) => (c.key === "deny" ? String(c.new).includes("SEND_MESSAGES") : false));
  if (!denySend) return null; // pas un verrouillage @everyone : pas assez sûr pour l'afficher comme tel, on se tait
  return { title: `Permission de salon ${verb}`, fields: [channelField(entry)] };
}

/** Horodatage lisible, même format que le CrowBot du serveur (jj/mm/aaaa hh:mm:ss, heure du serveur). */
function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Poste une entrée de log déjà construite (titre + champs) dans le salon
 * configuré pour `category` (utils/modLogStore.js). Fonction partagée :
 * utilisée par le relais d'audit ci-dessous ET par utils/moderation/actions.js
 * pour les actions de CE bot — une seule implémentation de "comment on
 * envoie une ligne de log", pas deux. Auteur et raison sont ajoutés ici
 * plutôt que dans chaque appelant : même format de carte partout.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {"moderation"|"members"|"roles"|"channels"|"voice"|"server"|"bots"|"messages"} category
 * @param {{ title: string, fields: {label: string, value: string}[], moderatorId?: string|null, moderatorTag?: string|null, reason?: string|null }} entry
 */
async function postModerationEntry(client, guildId, category, { title, fields, moderatorId = null, moderatorTag = null, reason = null }) {
  const channelId = getLogChannelId(guildId, category);
  if (!channelId) return;

  const guild = client.guilds.cache.get(guildId);
  const channel = guild?.channels.cache.get(channelId) ?? (await guild?.channels.fetch(channelId).catch(() => null));
  if (!channel?.isTextBased()) return;

  // "Auteur" n'est ajouté que si un exécuteur est connu : certains événements
  // (voir logMessageDelete) fournissent déjà leur propre champ "Auteur" au
  // sens différent (l'auteur DU message, pas de l'action) — pas la peine
  // d'en ajouter un second, vide, à la suite.
  const allFields = [
    ...fields,
    moderatorId || moderatorTag ? { label: "Auteur", value: moderatorId ? `<@${moderatorId}> (${moderatorId})` : moderatorTag } : null,
    reason ? { label: "Raison", value: reason } : null,
  ].filter(Boolean);

  // Components V2, comme le reste du bot (panels, confirmations) — sans
  // setAccentColor, volontairement : c'est justement cette barre colorée sur
  // le côté qui donnait encore un air d'embed classique (voir le même choix
  // dans utils/configPanel.js et utils/helpPanel.js). Titre en gras +
  // séparateur + une ligne par champ + un horodatage en petit texte : même
  // présentation que le salon de logs du CrowBot déjà présent sur le serveur.
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`**${title}**`));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(allFields.map((f) => `**${f.label} :** ${f.value}`).join("\n"))
  );
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${formatTimestamp()}`));

  // Message permanent, volontairement pas de suppression automatique : c'est
  // tout l'intérêt de ce salon face aux confirmations qui s'effacent d'elles-
  // mêmes ailleurs dans le bot.
  await channel.send({ flags: MessageFlags.IsComponentsV2, components: [container] }).catch((err) => {
    console.error(`[moderationLog] échec d'envoi dans le salon de logs (${channelId}) :`, err.message);
  });
}

/**
 * Relaie une entrée du journal d'audit Discord vers le salon de logs
 * configuré (utils/modLogStore.js), si le serveur en a un pour cette
 * catégorie. Ne fait rien silencieusement si le type d'action n'est pas
 * suivi, si l'exécuteur est CE bot (voir l'explication en tête de fichier),
 * ou si l'envoi échoue (salon supprimé, permission retirée...).
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Guild} guild
 * @param {import('discord.js').GuildAuditLogsEntry} entry
 */
async function relayAuditLogEntry(client, guild, entry) {
  if (entry.executorId === client.user.id) return; // voir utils/moderation/actions.js

  const handler = HANDLERS[entry.action];
  if (!handler) return;

  let result;
  try {
    result = handler.describe(entry);
  } catch (err) {
    console.error("[moderationLog] échec de description d'une entrée d'audit :", err);
    return;
  }
  if (!result) return;

  await postModerationEntry(client, guild.id, handler.category, {
    title: result.title,
    fields: result.fields,
    moderatorId: entry.executorId || null,
    moderatorTag: entry.executor?.tag || null,
    reason: entry.reason || null,
  });

  if (handler.history) {
    let record;
    try {
      record = handler.history(entry);
    } catch (err) {
      console.error("[moderationLog] échec d'enregistrement d'historique :", err);
      return;
    }
    if (!record) return;
    historyStore.record({
      guildId: guild.id,
      moderatorId: entry.executorId || "unknown",
      moderatorTag: entry.executor?.tag || null,
      reason: entry.reason || null,
      source: "audit-log",
      ...record,
    });
  }
}

/**
 * Journalise la suppression d'UN message (pas en masse, voir
 * MessageBulkDelete ci-dessus) avec son contenu — catégorie "messages",
 * distincte de "moderation". Le journal d'audit Discord ne donne ni le
 * contenu ni, dans la plupart des cas, un exécuteur fiable pour une
 * suppression de message ordinaire : ceci s'appuie plutôt sur le message
 * mis en cache par le client au moment de sa suppression (voir index.js,
 * même mécanisme que &snipe) — l'auteur du message, pas qui l'a supprimé,
 * que Discord ne fournit dans aucun des deux cas pour un message qu'on a
 * supprimé soi-même.
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Message} message message tel qu'en cache avant suppression
 */
async function logMessageDelete(client, message) {
  await postModerationEntry(client, message.guild.id, "messages", {
    title: "Message supprimé",
    fields: [
      { label: "Auteur", value: `<@${message.author.id}> (${message.author.id})` },
      { label: "Salon", value: `<#${message.channel.id}> (${message.channel.id})` },
      { label: "Contenu", value: message.content ? message.content.slice(0, 1000) : "*(aucun contenu texte)*" },
      { label: "Message ID", value: message.id },
    ],
  });
}

/**
 * Journalise un changement de salon vocal (rejoint/quitté/déplacé) —
 * catégorie "voice". Le journal d'audit Discord ne couvre pas les
 * rejoints/départs volontaires (seulement les déconnexions FORCÉES, déjà
 * gérées par MemberDisconnect ci-dessus) : ceci s'appuie sur
 * voiceStateUpdate directement (voir index.js).
 *
 * Volontairement muet pour les salons vocaux temporaires (&voicehub) : leur
 * churn est normal et fréquent, le journaliser noierait le salon de logs
 * sans rien apporter — seuls les VRAIS salons du serveur sont suivis.
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').VoiceState} oldState
 * @param {import('discord.js').VoiceState} newState
 */
async function logVoiceStateChange(client, oldState, newState) {
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const before = oldState.channelId;
  const after = newState.channelId;
  if (before === after) return; // sourdine/muet/statut... pas un changement de salon

  const isTempChannel = (id) => Boolean(id && voiceChannels.getChannelInfo(id));
  if (isTempChannel(before) || isTempChannel(after)) return;

  let title;
  let fields;
  if (!before && after) {
    title = "Rejoint un salon vocal";
    fields = [{ label: "Membre", value: `<@${member.id}> (${member.id})` }, { label: "Salon", value: `<#${after}>` }];
  } else if (before && !after) {
    title = "Quitté un salon vocal";
    fields = [{ label: "Membre", value: `<@${member.id}> (${member.id})` }, { label: "Salon", value: `<#${before}>` }];
  } else {
    title = "Changé de salon vocal";
    fields = [
      { label: "Membre", value: `<@${member.id}> (${member.id})` },
      { label: "De", value: `<#${before}>` },
      { label: "Vers", value: `<#${after}>` },
    ];
  }
  await postModerationEntry(client, newState.guild.id, "voice", { title, fields });
}

/**
 * Journalise l'édition d'un message — catégorie "messages", à côté de
 * logMessageDelete. Ne fait rien si le contenu texte n'a pas changé (Discord
 * déclenche aussi cet événement pour un embed qui se charge, une réaction...).
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Message} oldMessage tel qu'en cache avant l'édition (peut être partiel)
 * @param {import('discord.js').Message} newMessage message après édition
 */
async function logMessageEdit(client, oldMessage, newMessage) {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if ((oldMessage.content || "") === (newMessage.content || "")) return;

  await postModerationEntry(client, newMessage.guild.id, "messages", {
    title: "Message modifié",
    fields: [
      { label: "Auteur", value: `<@${newMessage.author.id}> (${newMessage.author.id})` },
      { label: "Salon", value: `<#${newMessage.channel.id}>` },
      { label: "Avant", value: oldMessage.content ? oldMessage.content.slice(0, 500) : "*(inconnu — message non mis en cache)*" },
      { label: "Après", value: newMessage.content ? newMessage.content.slice(0, 500) : "*(vide)*" },
      { label: "Lien", value: newMessage.url },
    ],
  });
}

module.exports = { relayAuditLogEntry, postModerationEntry, logMessageDelete, logVoiceStateChange, logMessageEdit };
