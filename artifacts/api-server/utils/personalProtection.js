const {
  AuditLogEvent,
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
  MessageFlags,
} = require("discord.js");
const { EMOJI } = require("./emojis");
const store = require("./personalProtectionStore");
const lists = require("./personalListsStore");
const quarantineStore = require("./adminQuarantineStore");
const messageOwner = require("./messageOwner");
const { getPrefixes } = require("./prefixStore");
const { can } = require("./permissions/engine");
const accessStore = require("./accessStore");
const muteStore = require("./muteStore");
const { report } = require("./moderation/actions");

// !!panel — panel de protection PERSONNELLE, sur un préfixe séparé exprès
// pour ne jamais se mélanger avec &panel (configuration du SERVEUR, voir
// utils/configPanel.js) NI avec !!secur (sécurité serveur + anti-nuke, voir
// utils/securityPanel.js — demande explicite : "je veux une commande pour
// panel perso et une commande avec tout les truc de securité"). "Ça te
// concerne toi seul" : chaque bouton active/désactive une protection pour la
// personne qui clique, aucun effet sur le reste du serveur — voir
// utils/personalProtectionStore.js pour la liste.
//
// GARDE-FOU COMMUN À TOUTE PROTECTION QUI ANNULE UNE ACTION (tout sauf
// Anti-Ping-Fantôme, qui ne fait qu'alerter) : voir estActionLegitime()
// ci-dessous. Sans ça, un membre malveillant pourrait s'auto-immuniser
// contre une vraie sanction juste en activant "Anti-Bannissement" — ce
// panel doit protéger contre le harcèlement, pas devenir un outil pour
// échapper à la modération légitime.

const CUSTOM_ID = "prot";

/** Rang RÉEL (owner/sys, utils/accessStore.js) — jamais de rang inventé ("dev" n'existe pas ici). */
function rangLabel(userId) {
  if (accessStore.isOwner(userId)) return `${EMOJI.OWNER} Propriétaire`;
  if (accessStore.isSys(userId)) return `${EMOJI.CROWN} Rang sys`;
  return "Membre";
}

// Les protections qui reposent sur une LISTE de membres plutôt qu'un
// simple on/off (utils/personalListsStore.js) — "Gérer une liste
// personnelle" ci-dessous les couvre toutes, un aller-retour à la fois.
const LISTES_GEREES = [
  { cle: "antiMentionPerso", label: "Anti-Mention Perso : liste surveillée" },
  { cle: "muteBot", label: "Mute Bot : cible désignée" },
];

function buildPanel(member, state = {}) {
  const settings = store.getSettings(member.guild.id, member.id);
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${EMOJI.LOCK} Panel perso`));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("Ça te concerne **toi seul** — le reste du serveur n'est pas touché.")
  );

  const onCount = Object.values(settings).filter(Boolean).length;
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        "## 📊 Résumé",
        `Compte : <@${member.id}> — ${rangLabel(member.id)}`,
        `${EMOJI.CHECK} ${onCount} activée(s) · ${EMOJI.CROSS} ${Object.keys(store.PROTECTIONS).length - onCount} désactivée(s)`,
      ].join("\n")
    )
  );

  const boutons = Object.entries(store.PROTECTIONS).map(([key, def]) => {
    const actif = settings[key];
    return new ButtonBuilder()
      .setCustomId(`${CUSTOM_ID}:toggle:${key}`)
      .setLabel(`${def.label} — ${actif ? "ON" : "OFF"}`)
      .setStyle(actif ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji(actif ? EMOJI.CHECK : EMOJI.CROSS);
  });
  // Discord limite une ActionRow à 5 boutons.
  for (let i = 0; i < boutons.length; i += 5) {
    container.addActionRowComponents(new ActionRowBuilder().addComponents(boutons.slice(i, i + 5)));
  }

  const lignes = Object.entries(store.PROTECTIONS).map(
    ([key, def]) => `${settings[key] ? EMOJI.CHECK : EMOJI.CROSS} **${def.label}** — ${def.description}`
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lignes.join("\n")));

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${CUSTOM_ID}:listaction`)
        .setPlaceholder("Gérer une liste personnelle")
        .addOptions(LISTES_GEREES.map((l) => new StringSelectMenuOptionBuilder().setLabel(l.label).setValue(l.cle).setDefault(l.cle === state.liste)))
    )
  );

  if (state.liste === "muteBot") {
    const cibleActuelle = lists.getTarget(member.guild.id, member.id);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`Cible actuelle : ${cibleActuelle ? `<@${cibleActuelle}>` : "*aucune*"}`)
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId(`${CUSTOM_ID}:target`).setPlaceholder("Définir la cible (vide = aucune)").setMinValues(0)
      )
    );
  } else if (state.liste) {
    const listeActuelle = lists.getList(member.guild.id, member.id, state.liste);
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `Liste actuelle (${listeActuelle.length}) : ${listeActuelle.length ? listeActuelle.map((id) => `<@${id}>`).join(", ") : "*vide*"}`
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${CUSTOM_ID}:listadd:${state.liste}`).setPlaceholder("Ajouter à la liste"))
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${CUSTOM_ID}:listdel:${state.liste}`).setPlaceholder("Retirer de la liste"))
    );
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * À appeler dans l'écouteur "messageCreate", en parallèle de
 * handleTextCommand (voir index.js). Lit elle-même le préfixe "!!".
 */
async function handleProtectionTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const { protection: PREFIX } = getPrefixes(message.guild.id);
  if (!PREFIX || !content.startsWith(PREFIX)) return;

  const [cmd] = content.slice(PREFIX.length).trim().split(/\s+/);
  if ((cmd || "").toLowerCase() !== "panel") return; // mot inconnu sur ce préfixe : silence, comme "&"

  return messageOwner.repondreEtRetenir(message, buildPanel(message.member));
}

/**
 * Clics du panel — voir index.js pour le routage par customId. La propriété
 * du panneau (seul l'auteur peut cliquer) est déjà vérifiée en amont dans
 * index.js, comme pour "cfg:" — pas besoin de la revérifier ici.
 */
async function handleProtectionInteraction(interaction) {
  const [, action, key] = interaction.customId.split(":");
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;

  if (action === "toggle") {
    if (!store.PROTECTIONS[key]) return;
    store.toggle(guildId, userId, key);
    return interaction.update(buildPanel(interaction.member));
  }

  if (action === "listaction") {
    const liste = interaction.values[0];
    if (!LISTES_GEREES.some((l) => l.cle === liste)) return;
    return interaction.update(buildPanel(interaction.member, { liste }));
  }

  if (action === "listadd" || action === "listdel") {
    if (!LISTES_GEREES.some((l) => l.cle === key) || key === "muteBot") return;
    const cibleId = interaction.values[0];
    const present = lists.getList(guildId, userId, key).includes(cibleId);
    if (action === "listadd" && !present) lists.toggleInList(guildId, userId, key, cibleId);
    else if (action === "listdel" && present) lists.toggleInList(guildId, userId, key, cibleId);
    return interaction.update(buildPanel(interaction.member, { liste: key }));
  }

  if (action === "target") {
    lists.setTarget(guildId, userId, interaction.values[0] || null);
    return interaction.update(buildPanel(interaction.member, { liste: "muteBot" }));
  }
}

/**
 * Une action qui a touché `targetId` est-elle légitime (donc à ne PAS
 * annuler) ? Dans l'ordre :
 *  1. cible = exécuteur, ou exécuteur inconnu/introuvable : jamais annulé —
 *     beaucoup de changements sur SOI-MÊME (pseudo, déplacement vocal en se
 *     changeant soi-même de salon) ne génèrent d'ailleurs AUCUNE entrée
 *     d'audit, donc ce cas couvre aussi "on n'a rien pu attribuer" ;
 *  2. exécuteur = ce bot, ou n'importe quel autre bot du serveur (CrowBot
 *     compris) : déjà géré par son propre système de permissions ;
 *  3. exécuteur humain confirmé : légitime UNIQUEMENT s'il détient la
 *     permission `permKey` de ce bot. Sans clé de référence (déplacement/
 *     sourdine vocale forcés, qui n'ont pas d'équivalent dans le catalogue
 *     de permissions), un humain confirmé n'est jamais légitime.
 *
 * Sans ce filtre, activer une protection reviendrait à s'auto-immuniser
 * contre une vraie sanction (bannissement, expulsion, timeout...) — le but
 * est de protéger contre le harcèlement, pas de fournir une échappatoire à
 * la modération légitime.
 */
async function estActionLegitime(guild, executorId, targetId, permKey) {
  if (!executorId || executorId === targetId) return true;
  if (executorId === guild.client.user.id) return true;
  const executeur = await guild.members.fetch(executorId).catch(() => null);
  if (!executeur) return true;
  if (executeur.user?.bot) return true;
  if (!permKey) return false;
  return can(executeur, permKey);
}

/**
 * À appeler depuis l'écouteur "guildAuditLogEntryCreate" existant
 * d'index.js, EN PLUS de relayAuditLogEntry/checkAuditEntry — même entrée,
 * traitement indépendant. Couvre Anti-Retrait-Rôle, Anti-Renommage,
 * Anti-Sourdine-Forcée, Anti-Timeout, Anti-Bannissement et Alerte-Expulsion :
 * ces six ont toutes un `entry.targetId` exploitable directement, donc pas
 * besoin d'interroger l'audit log nous-mêmes (contrairement à
 * enforceMoveProtection ci-dessous).
 */
async function handleAuditLogEntry(client, guild, entry) {
  if (entry.action === AuditLogEvent.MemberRoleUpdate) {
    const removed = entry.changes?.find((c) => c.key === "$remove")?.new || [];
    if (!removed.length || !store.isEnabled(guild.id, entry.targetId, "antiRoleRemove")) return;
    if (await estActionLegitime(guild, entry.executorId, entry.targetId, "members.role")) return;
    await quarantineExecuteur(guild, entry.executorId, entry.targetId);
    const idsEncoreValides = removed.map((r) => r.id).filter((id) => guild.roles.cache.has(id));
    if (!idsEncoreValides.length) return;
    const membre = await guild.members.fetch(entry.targetId).catch(() => null);
    if (!membre) return;
    await membre.roles.add(idsEncoreValides, "Anti-Retrait Rôle (!!panel)").catch((err) => {
      console.error("[personalProtection] réapplication de rôle impossible :", err.message);
    });
    return;
  }

  if (entry.action === AuditLogEvent.MemberUpdate) {
    const timeout = entry.changes?.find((c) => c.key === "communication_disabled_until");
    const nick = entry.changes?.find((c) => c.key === "nick");
    const mute = entry.changes?.find((c) => c.key === "mute");
    const deaf = entry.changes?.find((c) => c.key === "deaf");

    if (timeout?.new && store.isEnabled(guild.id, entry.targetId, "antiTimeout")) {
      if (!(await estActionLegitime(guild, entry.executorId, entry.targetId, "moderation.timeout"))) {
        await quarantineExecuteur(guild, entry.executorId, entry.targetId);
        const membre = await guild.members.fetch(entry.targetId).catch(() => null);
        await membre?.timeout(null, "Anti-Timeout (!!panel)").catch((err) => {
          console.error("[personalProtection] anti-timeout impossible :", err.message);
        });
      }
    }

    if (nick && store.isEnabled(guild.id, entry.targetId, "antiRename")) {
      if (!(await estActionLegitime(guild, entry.executorId, entry.targetId, "members.nick"))) {
        await quarantineExecuteur(guild, entry.executorId, entry.targetId);
        const membre = await guild.members.fetch(entry.targetId).catch(() => null);
        await membre?.setNickname(nick.old || null, "Anti-Renommage (!!panel)").catch((err) => {
          console.error("[personalProtection] anti-renommage impossible :", err.message);
        });
      }
    }

    if ((mute?.new || deaf?.new) && store.isEnabled(guild.id, entry.targetId, "antiMuteDeafen")) {
      if (!(await estActionLegitime(guild, entry.executorId, entry.targetId, null))) {
        await quarantineExecuteur(guild, entry.executorId, entry.targetId);
        const membre = await guild.members.fetch(entry.targetId).catch(() => null);
        if (mute?.new) await membre?.voice?.setMute(false, "Anti-Sourdine Forcée (!!panel)").catch(() => {});
        if (deaf?.new) await membre?.voice?.setDeaf(false, "Anti-Sourdine Forcée (!!panel)").catch(() => {});
      }
    }
    return;
  }

  if (entry.action === AuditLogEvent.MemberBanAdd) {
    if (!store.isEnabled(guild.id, entry.targetId, "antiBan")) return;
    if (await estActionLegitime(guild, entry.executorId, entry.targetId, "moderation.ban")) return;
    await quarantineExecuteur(guild, entry.executorId, entry.targetId);
    await guild.members.unban(entry.targetId, "Anti-Bannissement (!!panel)").catch((err) => {
      console.error("[personalProtection] anti-bannissement impossible :", err.message);
    });
    return;
  }

  if (entry.action === AuditLogEvent.MemberKick) {
    if (!store.isEnabled(guild.id, entry.targetId, "antiKick")) return;
    if (await estActionLegitime(guild, entry.executorId, entry.targetId, "moderation.kick")) return;
    await quarantineExecuteur(guild, entry.executorId, entry.targetId);
    await envoyerAlerteExpulsion(guild, entry.targetId).catch((err) => {
      console.error("[personalProtection] alerte expulsion impossible :", err.message);
    });
  }
}

/**
 * Quarantaine Admin : en plus d'annuler l'action elle-même (fait par
 * l'appelant), isole temporairement l'EXÉCUTEUR illégitime — snapshot de
 * ses rôles (hors @everyone) puis retrait, restaurés après échéance par
 * checkExpiredQuarantines(). Best-effort : un exécuteur introuvable ou
 * déjà sans rôle ne fait rien planter, juste rien à quarantiner.
 */
async function quarantineExecuteur(guild, executorId, targetId) {
  if (!store.isEnabled(guild.id, targetId, "quarantineAdmin")) return;
  if (!executorId) return;
  const executeur = await guild.members.fetch(executorId).catch(() => null);
  if (!executeur) return;
  const roleIds = [...executeur.roles.cache.keys()].filter((id) => id !== guild.id);
  if (!roleIds.length) return;
  try {
    await executeur.roles.remove(roleIds, "Quarantaine Admin (!!panel) — action illégitime détectée");
  } catch (err) {
    console.error("[personalProtection] mise en quarantaine impossible :", err.message);
    return;
  }
  quarantineStore.add(guild.id, executorId, roleIds);
}

/**
 * Appelée périodiquement (voir index.js) pour rendre à un exécuteur mis en
 * quarantaine (voir quarantineExecuteur) les rôles qui lui avaient été
 * retirés, une fois l'échéance passée.
 */
async function checkExpiredQuarantines(client) {
  for (const entry of quarantineStore.getExpired()) {
    quarantineStore.remove(entry.guildId, entry.userId);
    const guild = client.guilds.cache.get(entry.guildId);
    if (!guild) continue;
    const membre = await guild.members.fetch(entry.userId).catch(() => null);
    if (!membre) continue;
    const idsEncoreValides = entry.roleIds.filter((id) => guild.roles.cache.has(id));
    if (!idsEncoreValides.length) continue;
    await membre.roles.add(idsEncoreValides, "Fin de quarantaine (!!panel)").catch((err) => {
      console.error(`[personalProtection] restauration de quarantaine impossible pour ${membre.id} :`, err.message);
    });
  }
}

/**
 * Un bot ne peut pas re-ajouter de force un membre expulsé — au mieux, une
 * invitation par MP pour qu'il revienne lui-même s'il le souhaite.
 */
async function envoyerAlerteExpulsion(guild, userId) {
  const utilisateur = await guild.client.users.fetch(userId).catch(() => null);
  if (!utilisateur) return;
  const salon = guild.channels.cache.find(
    (c) => c.isTextBased?.() && c.viewable && c.permissionsFor(guild.members.me)?.has("CreateInstantInvite")
  );
  const invite = await salon?.createInvite({ maxAge: 86400, maxUses: 1, unique: true, reason: "Alerte Expulsion (!!panel)" }).catch(() => null);
  const lien = invite ? `\nVoici une invitation pour revenir si tu le souhaites : ${invite.url}` : "";
  await utilisateur.send(`Tu as été expulsé de **${guild.name}**.${lien}`).catch(() => {});
}

/**
 * Anti-Déplacement Vocal — à appeler depuis "voiceStateUpdate" (index.js).
 * Seul cas de ce fichier qui interroge l'audit log lui-même plutôt que de
 * réagir à "guildAuditLogEntryCreate" : un déplacement vocal (MemberMove)
 * n'a PAS de `targetId` (Discord le journalise par salon de destination et
 * un compte de membres déplacés, jamais par membre précis), donc on ne peut
 * pas router ça via handleAuditLogEntry comme les autres. On recoupe à la
 * place le salon de destination et un court délai — best-effort.
 */
async function enforceMoveProtection(oldState, newState) {
  const member = newState.member;
  if (!member) return;
  if (!oldState.channelId || !newState.channelId || oldState.channelId === newState.channelId) return;
  if (!store.isEnabled(newState.guild.id, member.id, "antiMove")) return;

  const logs = await newState.guild.fetchAuditLogs({ type: AuditLogEvent.MemberMove, limit: 3 }).catch(() => null);
  const recent = [...(logs?.entries?.values() || [])].find(
    (e) => e.extra?.channel?.id === newState.channelId && Date.now() - e.createdTimestamp < 5000
  );
  if (!recent) return; // pas de déplacement imposé détecté — probablement volontaire
  if (await estActionLegitime(newState.guild, recent.executorId, member.id, null)) return;

  await member.voice.setChannel(oldState.channelId, "Anti-Déplacement Vocal (!!panel)").catch((err) => {
    console.error("[personalProtection] anti-déplacement impossible :", err.message);
  });
}

/**
 * Anti-Ping-Fantôme — à appeler depuis "messageDelete" (index.js), en plus
 * du traitement existant (snipes/logs). N'annule rien : c'est une simple
 * alerte, donc pas de estActionLegitime ici.
 */
async function enforceGhostPingAlert(message) {
  if (!message.guild || message.author?.bot) return;
  const mentioned = message.mentions?.users;
  if (!mentioned?.size) return;

  for (const [, user] of mentioned) {
    if (user.id === message.author?.id) continue; // s'auto-mentionner puis se supprimer n'a rien de suspect
    if (!store.isEnabled(message.guild.id, user.id, "antiGhostPing")) continue;
    const contenu = message.content || "*(contenu indisponible — message supprimé avant mise en cache)*";
    await user
      .send(`**${message.author?.tag || "quelqu'un"}** t'a mentionné dans **${message.guild.name}** puis a supprimé son message :\n> ${contenu}`)
      .catch(() => {});
  }
}

/**
 * Anti-Mention Perso — à appeler depuis "messageCreate" (index.js). Pour
 * CHAQUE utilisateur mentionné dans le message, si CE mentionné a la
 * protection active et surveille l'auteur du message (utils/
 * personalListsStore.js), lui envoie une alerte en MP. Jamais de sanction,
 * même principe qu'Anti-Ping-Fantôme.
 */
async function enforcePersonalMentionAlert(message) {
  if (!message.guild || message.author?.bot) return;
  const mentioned = message.mentions?.users;
  if (!mentioned?.size) return;

  for (const [, user] of mentioned) {
    if (user.id === message.author?.id) continue;
    if (!store.isEnabled(message.guild.id, user.id, "antiMentionPerso")) continue;
    if (!lists.getList(message.guild.id, user.id, "antiMentionPerso").includes(message.author.id)) continue;
    await user
      .send(`**${message.author?.tag || "quelqu'un"}** (que tu surveilles) t'a mentionné dans **${message.guild.name}**.`)
      .catch(() => {});
  }
}

/**
 * Anti-Delete Message — à appeler depuis "messageDelete" (index.js), en
 * plus d'enforceGhostPingAlert. Best-effort : Discord ne journalise une
 * suppression de message QUE si elle vient de quelqu'un avec "Gérer les
 * messages" (jamais une autosuppression) — l'absence d'entrée d'audit est
 * donc traitée comme une autosuppression probable, et reste silencieuse
 * plutôt que de risquer une fausse alerte.
 */
async function enforceDeleteAlert(message) {
  if (!message.guild || message.author?.bot) return;
  if (!store.isEnabled(message.guild.id, message.author.id, "antiDeleteMessage")) return;

  const logs = await message.guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 3 }).catch(() => null);
  const recent = [...(logs?.entries?.values() || [])].find(
    (e) => e.targetId === message.author.id && e.extra?.channel?.id === message.channelId && Date.now() - e.createdTimestamp < 5000
  );
  if (!recent || recent.executorId === message.author.id) return; // pas de trace, ou autosuppression : silence

  const contenu = message.content || "*(contenu indisponible — message supprimé avant mise en cache)*";
  await message.author
    .send(`Un de tes messages dans **${message.guild.name}** a été supprimé par <@${recent.executorId}> :\n> ${contenu}`)
    .catch(() => {});
}

/**
 * Mute Bot — à appeler depuis un écouteur "guildMemberUpdate" (nouveau,
 * voir index.js). Se déclenche quand le rôle de mute (utils/muteStore.js)
 * disparaît d'un membre : si quelqu'un le protège avec Mute Bot (utils/
 * personalListsStore.js::findMuteBotProtectors) et que ce n'est PAS ce
 * protecteur qui a démuté (recoupement audit log, même principe
 * qu'enforceMoveProtection), le rôle est réappliqué.
 */
async function enforceMuteBot(oldMember, newMember) {
  const guild = newMember.guild;
  const roleId = muteStore.getMuteRoleId(guild.id);
  if (!roleId) return;
  const avaitLeRole = oldMember.roles.cache.has(roleId);
  const aEncoreLeRole = newMember.roles.cache.has(roleId);
  if (!avaitLeRole || aEncoreLeRole) return; // le rôle n'a pas disparu

  const protecteurs = lists.findMuteBotProtectors(guild.id, newMember.id).filter((id) => store.isEnabled(guild.id, id, "muteBot"));
  if (!protecteurs.length) return;

  const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 3 }).catch(() => null);
  const recent = [...(logs?.entries?.values() || [])].find((e) => e.targetId === newMember.id && Date.now() - e.createdTimestamp < 5000);
  const executorId = recent?.executorId || null;

  // Si c'est justement UN des protecteurs qui a démuté, on respecte son choix.
  if (executorId && protecteurs.includes(executorId)) return;

  const role = guild.roles.cache.get(roleId);
  if (!role) return;
  await newMember.roles.add(role, "Mute Bot (!!panel)").catch((err) => {
    console.error("[personalProtection] mute bot impossible :", err.message);
  });
}

module.exports = {
  handleProtectionTextCommand,
  handleProtectionInteraction,
  handleAuditLogEntry,
  enforceMoveProtection,
  enforceGhostPingAlert,
  enforcePersonalMentionAlert,
  enforceDeleteAlert,
  enforceMuteBot,
  checkExpiredQuarantines,
  CUSTOM_ID,
};
