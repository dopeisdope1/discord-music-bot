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
  MessageFlags,
} = require("discord.js");
const { EMOJI } = require("./emojis");
const store = require("./personalProtectionStore");
const messageOwner = require("./messageOwner");
const { getPrefixes } = require("./prefixStore");
const { can } = require("./permissions/engine");
const automod = require("./automod/antiSpam");
const antiLink = require("./automod/antiLink");
const antiMention = require("./automod/antiMention");
const badWords = require("./automod/badWords");
const accessStore = require("./accessStore");
const muteStore = require("./muteStore");
const guardConfig = require("./guard/config");
const { ALL_GUARDS } = require("./guard/definitions");
const { computeStatus, formatUptime } = require("./statusDiagnostic");

// !!panel — panel de protection PERSONNELLE, sur un préfixe séparé exprès
// pour ne jamais se mélanger avec &panel (configuration du SERVEUR, voir
// utils/configPanel.js). "Ça te concerne toi seul" pour la partie du haut :
// chaque bouton active/désactive une protection pour la personne qui clique,
// aucun effet sur le reste du serveur — voir utils/personalProtectionStore.js
// pour la liste. En bas, une rubrique "Sécurité serveur" reprend TELS QUELS
// les réglages de &panel > Protection (antispam/antilien/antimention/mots
// interdits) — même magasins, juste un second point d'accès, pour ne pas
// avoir à rouvrir &panel pour ça (demande explicite : "tout les protections
// qu'il y'a dans le &panel ajoute les dans !!panel").
//
// GARDE-FOU COMMUN À TOUTE PROTECTION QUI ANNULE UNE ACTION (tout sauf
// Anti-Ping-Fantôme, qui ne fait qu'alerter) : voir estActionLegitime()
// ci-dessous. Sans ça, un membre malveillant pourrait s'auto-immuniser
// contre une vraie sanction juste en activant "Anti-Bannissement" — ce
// panel doit protéger contre le harcèlement, pas devenir un outil pour
// échapper à la modération légitime.

const CUSTOM_ID = "prot";

// Rubrique "Sécurité serveur" : mêmes 4 interrupteurs que &panel > Protection
// (utils/configPanel.js, section "protection"), avec les mêmes magasins.
const SERVEUR_TOGGLES = [
  { key: "antiSpam", label: "Anti-Spam/Flood", store: automod },
  { key: "antiLien", label: "Anti-Lien", store: antiLink },
  { key: "antiMassMention", label: "Anti-Mass-Mention", store: antiMention },
  { key: "motsInterdits", label: "Mots interdits", store: badWords },
];

/** Rang RÉEL (owner/sys, utils/accessStore.js) — jamais de rang inventé ("dev" n'existe pas ici). */
function rangLabel(userId) {
  if (accessStore.isOwner(userId)) return `${EMOJI.OWNER} Propriétaire`;
  if (accessStore.isSys(userId)) return `${EMOJI.CROWN} Rang sys`;
  return "Membre";
}

/** Compte live des membres actuellement sanctionnés par le rôle de mute (utils/muteStore.js) — pas de compteur pré-calculé, donc lu à la volée. */
function compterMuted(guild) {
  const roleId = muteStore.getMuteRoleId(guild?.id);
  if (!roleId) return 0;
  return guild?.roles?.cache?.get(roleId)?.members?.size || 0;
}

/** `client` est absent dans une partie des tests (et parfois indisponible) : jamais bloquant, juste une ligne en moins dans le résumé. */
function statsBot(client) {
  if (!client?.ws || !client?.guilds) return null;
  const info = computeStatus(client);
  return { uptime: formatUptime(info.uptimeMs), ping: info.ping };
}

/**
 * Page 0 — "Panel de contrôle" : résumé + recensement de TOUTES les
 * protections réelles (personnelles, sécurité serveur, anti-nuke), plus le
 * pilotage de l'anti-nuke (utils/guard/*.js) — jusqu'ici visible seulement
 * dans &panel. Rien d'inventé : chaque nombre vient d'un store existant.
 */
function buildDashboardPage(member, client) {
  const guild = member.guild;
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## 🛡️ Panel de contrôle"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  const stats = statsBot(client);
  const resume = [
    `${EMOJI.OWNER} **${accessStore.ownerIds().length}** propriétaire(s) · ${EMOJI.CROWN} **${accessStore.list("sys").length}** rang sys`,
    `🔇 **${compterMuted(guild)}** muet(s) (rôle de mute)`,
  ];
  if (stats) resume.push(`⏱️ **${stats.uptime}** · 📶 **${stats.ping}ms**`);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(resume.join("\n")));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  const settingsPerso = store.getSettings(guild.id, member.id);
  const onPerso = Object.values(settingsPerso).filter(Boolean).length;
  const totalPerso = Object.keys(store.PROTECTIONS).length;
  const lignesFonctions = [`**Tes protections personnelles** : ${onPerso}/${totalPerso} actives — détail page 2/2`];

  const droitServeur = can(member, "protection.automod");
  if (droitServeur) {
    const onSrv = SERVEUR_TOGGLES.filter((t) => t.store.getConfig(guild.id).enabled).length;
    lignesFonctions.push(`**Sécurité serveur** : ${onSrv}/${SERVEUR_TOGGLES.length} actives — détail page 2/2`);
  } else {
    lignesFonctions.push("**Sécurité serveur** : 🔒 droit `protection.automod` requis");
  }

  const droitGuard = can(member, "protection.guard.manage");
  if (droitGuard) {
    const configGuard = guardConfig.getConfig(guild.id);
    const onGuard = ALL_GUARDS.filter((g) => guardConfig.isGuardEnabled(guild.id, g.key)).length;
    lignesFonctions.push(
      `**Anti-nuke** : ${onGuard}/${ALL_GUARDS.length} actives${
        configGuard.enabled ? "" : " (⚠️ interrupteur général éteint — &panel > Anti-nuke)"
      }`
    );
    for (let i = 0; i < ALL_GUARDS.length; i += 2) {
      const a = ALL_GUARDS[i];
      const b = ALL_GUARDS[i + 1];
      const texteA = `${guardConfig.isGuardEnabled(guild.id, a.key) ? EMOJI.CHECK : EMOJI.CROSS} \`${a.key}\``;
      const texteB = b ? ` · ${guardConfig.isGuardEnabled(guild.id, b.key) ? EMOJI.CHECK : EMOJI.CROSS} \`${b.key}\`` : "";
      lignesFonctions.push(`${texteA}${texteB}`);
    }
  } else {
    lignesFonctions.push("**Anti-nuke** : 🔒 droit `protection.guard.manage` requis");
  }

  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## 🛡️ Fonctions\n${lignesFonctions.join("\n")}`));

  if (droitGuard) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${CUSTOM_ID}:guardpick`)
          .setPlaceholder("Activer/Désactiver une protection anti-nuke")
          .addOptions(
            ALL_GUARDS.map((g) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(g.label)
                .setValue(g.key)
                .setDescription(guardConfig.isGuardEnabled(guild.id, g.key) ? "Actuellement activée" : "Actuellement désactivée")
            )
          )
      )
    );
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${CUSTOM_ID}:guardall:on`).setLabel("Tout activer").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${CUSTOM_ID}:guardall:off`).setLabel("Tout désactiver").setStyle(ButtonStyle.Danger)
      )
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:page:0`).setLabel("Actualiser").setStyle(ButtonStyle.Secondary).setEmoji("🔄"),
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:page:1`).setLabel("Page suivante").setStyle(ButtonStyle.Secondary).setEmoji("▶")
    )
  );
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("-# page 1/2 — fonctions & accès"));

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** Page 1 — "Panel perso" : contenu EXISTANT (protections perso + Sécurité serveur), juste habillé d'un résumé et d'une pagination. */
function buildPersoPage(member) {
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

  if (can(member, "protection.automod")) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## 🛡️ Sécurité serveur\n*Les mêmes réglages que &panel > Protection.*")
    );
    const boutonsServeur = SERVEUR_TOGGLES.map((t) => {
      const actif = t.store.getConfig(member.guild.id).enabled;
      return new ButtonBuilder()
        .setCustomId(`${CUSTOM_ID}:srv:${t.key}`)
        .setLabel(`${t.label} — ${actif ? "ON" : "OFF"}`)
        .setStyle(actif ? ButtonStyle.Success : ButtonStyle.Secondary);
    });
    for (let i = 0; i < boutonsServeur.length; i += 5) {
      container.addActionRowComponents(new ActionRowBuilder().addComponents(boutonsServeur.slice(i, i + 5)));
    }
  }

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:page:0`).setLabel("Page précédente").setStyle(ButtonStyle.Secondary).setEmoji("◀"),
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:page:1`).setLabel("Actualiser").setStyle(ButtonStyle.Secondary).setEmoji("🔄")
    )
  );
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("-# page 2/2 — panel perso"));

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** Point d'entrée public : `page` 0 = dashboard (nouveau), 1 = panel perso (existant). */
function buildPanel(member, page = 0, client) {
  return page === 1 ? buildPersoPage(member) : buildDashboardPage(member, client);
}

/**
 * À appeler dans l'écouteur "messageCreate", en parallèle de
 * handleMusicTextCommand (voir index.js). Lit elle-même le préfixe "!!" —
 * même convention que utils/musicCommands.js::handleMusicTextCommand.
 */
async function handleProtectionTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const { protection: PREFIX } = getPrefixes(message.guild.id);
  if (!PREFIX || !content.startsWith(PREFIX)) return;

  const [cmd] = content.slice(PREFIX.length).trim().split(/\s+/);
  if ((cmd || "").toLowerCase() !== "panel") return; // mot inconnu sur ce préfixe : silence, comme "&"

  return messageOwner.repondreEtRetenir(message, buildPanel(message.member, 0, client));
}

/**
 * Clics du panel — voir index.js pour le routage par customId. La propriété
 * du panneau (seul l'auteur peut cliquer) est déjà vérifiée en amont dans
 * index.js, comme pour "cfg:" — pas besoin de la revérifier ici.
 * "toggle:<clé>" = une protection personnelle ; "srv:<clé>" = un interrupteur
 * de la rubrique Sécurité serveur, qui EXIGE protection.automod (revérifié
 * ici : la permission a pu changer depuis l'ouverture du panel).
 */
async function handleProtectionInteraction(interaction) {
  const [, action, key] = interaction.customId.split(":");

  if (action === "toggle") {
    if (!store.PROTECTIONS[key]) return;
    store.toggle(interaction.guild.id, interaction.user.id, key);
    return interaction.update(buildPanel(interaction.member, 1));
  }

  if (action === "srv") {
    const cible = SERVEUR_TOGGLES.find((t) => t.key === key);
    if (!cible) return;
    if (!can(interaction.member, "protection.automod")) {
      return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    }
    cible.store.setEnabled(interaction.guild.id, !cible.store.getConfig(interaction.guild.id).enabled);
    return interaction.update(buildPanel(interaction.member, 1));
  }

  if (action === "page") {
    const page = key === "1" ? 1 : 0;
    return interaction.update(buildPanel(interaction.member, page, interaction.client));
  }

  if (action === "guardpick") {
    if (!can(interaction.member, "protection.guard.manage")) {
      return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    }
    const guardKey = interaction.values[0];
    if (!ALL_GUARDS.some((g) => g.key === guardKey)) return;
    guardConfig.toggleGuard(interaction.guild.id, guardKey);
    return interaction.update(buildPanel(interaction.member, 0, interaction.client));
  }

  if (action === "guardall") {
    if (!can(interaction.member, "protection.guard.manage")) {
      return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    }
    const activer = key === "on";
    for (const g of ALL_GUARDS) guardConfig.setGuardEnabled(interaction.guild.id, g.key, activer);
    return interaction.update(buildPanel(interaction.member, 0, interaction.client));
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
        const membre = await guild.members.fetch(entry.targetId).catch(() => null);
        await membre?.timeout(null, "Anti-Timeout (!!panel)").catch((err) => {
          console.error("[personalProtection] anti-timeout impossible :", err.message);
        });
      }
    }

    if (nick && store.isEnabled(guild.id, entry.targetId, "antiRename")) {
      if (!(await estActionLegitime(guild, entry.executorId, entry.targetId, "members.nick"))) {
        const membre = await guild.members.fetch(entry.targetId).catch(() => null);
        await membre?.setNickname(nick.old || null, "Anti-Renommage (!!panel)").catch((err) => {
          console.error("[personalProtection] anti-renommage impossible :", err.message);
        });
      }
    }

    if ((mute?.new || deaf?.new) && store.isEnabled(guild.id, entry.targetId, "antiMuteDeafen")) {
      if (!(await estActionLegitime(guild, entry.executorId, entry.targetId, null))) {
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
    await guild.members.unban(entry.targetId, "Anti-Bannissement (!!panel)").catch((err) => {
      console.error("[personalProtection] anti-bannissement impossible :", err.message);
    });
    return;
  }

  if (entry.action === AuditLogEvent.MemberKick) {
    if (!store.isEnabled(guild.id, entry.targetId, "antiKick")) return;
    if (await estActionLegitime(guild, entry.executorId, entry.targetId, "moderation.kick")) return;
    await envoyerAlerteExpulsion(guild, entry.targetId).catch((err) => {
      console.error("[personalProtection] alerte expulsion impossible :", err.message);
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

module.exports = {
  handleProtectionTextCommand,
  handleProtectionInteraction,
  handleAuditLogEntry,
  enforceMoveProtection,
  enforceGhostPingAlert,
  CUSTOM_ID,
};
