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
  ChannelSelectMenuBuilder,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");
const { iconDe } = require("./emojiSlots");
const { getPrefixes } = require("./prefixStore");
const { can } = require("./permissions/engine");
const accessStore = require("./accessStore");
const muteStore = require("./muteStore");
const guardConfig = require("./guard/config");
const guardWhitelist = require("./guard/whitelist");
const { ALL_GUARDS } = require("./guard/definitions");
const { computeStatus, formatUptime } = require("./statusDiagnostic");
const { computeSecurityScan } = require("./securityScan");
const { parseDuration } = require("./moderationCommands");
const automod = require("./automod/antiSpam");
const antiLink = require("./automod/antiLink");
const antiMention = require("./automod/antiMention");
const badWords = require("./automod/badWords");
const antiScam = require("./automod/antiScam");

// "!!secur" — TOUT ce qui concerne la sécurité DU SERVEUR (par opposition à
// "!!panel", strictement personnel — voir utils/personalProtection.js).
// Contenu déménagé intégralement depuis &panel > Sécurité (Vue d'ensemble,
// Protection, Anti-nuke, Mute — utils/configPanel.js), sur demande
// explicite ("enlève tout les trucs de sécurité du &panel et le mets dans
// !!secur") : mêmes stores, mêmes permissions, mêmes réglages — seulement un
// nouveau point d'accès, jamais une nouvelle logique.
//
// Quatre "vues" choisies par un menu de sous-navigation (mêmes idée que
// utils/configPanel.js::buildSubNav), chacune reproduisant le texte d'état +
// le dispatcher "menu d'action -> contrôle révélé -> exécution" de la
// rubrique d'origine. Ce "state" (quelle action est en cours de réglage)
// n'est JAMAIS persisté : chaque clic reconstruit l'écran suivant à partir
// de ce que CE clic vient de choisir, et le contrôle révélé porte lui-même
// tout ce qu'il faut dans son propre customId pour le clic d'après — même
// principe que utils/palierPanel.js, en plus simple.
const CUSTOM_ID = "secur";

const VUES = [
  { key: "overview", label: "Vue d'ensemble" },
  { key: "protection", label: "Protection" },
  { key: "guard", label: "Anti-nuke" },
  { key: "mute", label: "Mute" },
];

const mentions = (ids) => (ids.length ? ids.map((id) => `<@${id}>`).join(", ") : "*personne*");

function estAutorise(member) {
  return can(member, "protection.automod") || can(member, "protection.guard.manage");
}

/** Compte live des membres actuellement sanctionnés par le rôle de mute (utils/muteStore.js) — pas de compteur pré-calculé, donc lu à la volée. */
function compterMuted(guild) {
  const roleId = muteStore.getMuteRoleId(guild?.id);
  if (!roleId) return 0;
  return guild?.roles?.cache?.get(roleId)?.members?.size || 0;
}

/** `client` est absent d'une partie des tests (et parfois indisponible) : jamais bloquant, juste une ligne en moins dans le résumé. */
function statsBot(client) {
  if (!client?.ws || !client?.guilds) return null;
  const info = computeStatus(client);
  return { uptime: formatUptime(info.uptimeMs), ping: info.ping };
}

function buildSubNav(vueActuelle) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${CUSTOM_ID}:subnav`)
      .setPlaceholder("Choisir une vue")
      .addOptions(VUES.map((v) => new StringSelectMenuOptionBuilder().setLabel(v.label).setValue(v.key).setDefault(v.key === vueActuelle)))
  );
}

// ---- Vue d'ensemble (lecture seule — même utils/securityScan.js que &panel > Accueil) ----

function corpsOverview(guild) {
  const { critical, warnings, ok } = computeSecurityScan(guild);
  const emoji = critical.length ? "🔴" : warnings.length ? "🟠" : "🟢";
  const lignes = [`${emoji} **${ok.length}** OK · **${warnings.length}** avertissement(s) · **${critical.length}** critique(s)`];
  if (critical.length) lignes.push("", "**🔴 Critique :**", ...critical.map((l) => `> ${l}`));
  if (warnings.length) lignes.push("", "**🟠 Avertissements :**", ...warnings.map((l) => `> ${l}`));
  if (!critical.length && !warnings.length) lignes.push("", "*Tout est en ordre — voir le détail dans Protection/Anti-nuke/Mute.*");
  return lignes.join("\n");
}

// ---- Vue Protection (anti-spam/anti-lien/anti-mass-mention/mots interdits/whitelist) ----

function corpsProtection(guildId) {
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
    `> Salons exemptés : ${automod.getExemptChannels(guildId).length ? automod.getExemptChannels(guildId).map((id) => `<#${id}>`).join(", ") : "*aucun*"}`,
    "",
    `> **Anti-lien** : ${linkConfig.enabled ? "activé" : "désactivé"} (mode : ${linkConfig.mode === "all" ? "tous les liens" : "invitations Discord"})`,
    `> Salons où les liens restent autorisés : ${linkAllowed.length ? linkAllowed.map((id) => `<#${id}>`).join(", ") : "*aucun*"}`,
    "",
    `> **Anti-mass-mention** : ${mentionConfig.enabled ? "activé" : "désactivé"} (seuil : ${mentionConfig.maxMentions} mentions, timeout ${mentionConfig.timeoutSeconds}s)`,
    "",
    `> **Mots interdits** : ${wordsConfig.enabled ? "activé" : "désactivé"} (${words.length} mot(s) dans la liste)`,
    "",
    `> **Anti-scam** : ${antiScam.getConfig(guildId).enabled ? "activé" : "désactivé"} (faux-nitro, faux Steam)`,
    "",
    `> **Whitelist (exemptés)** : ${mentions([...whitelist.users, ...whitelist.roles])}`,
  ].join("\n");
}

function controlesProtection(guild, member, state) {
  const rows = [];
  const words = badWords.getWords(guild.id);
  const options = [
    { value: "spam_toggle", label: "Anti-spam : activer/désactiver" },
    { value: "spam_threshold", label: "Anti-spam : changer le seuil (messages / secondes)" },
    { value: "spam_timeout", label: "Anti-spam : durée du timeout" },
    { value: "spam_exempt", label: "Anti-spam : salons exemptés" },
    { value: "link_toggle", label: "Anti-lien : activer/désactiver" },
    { value: "link_mode", label: "Anti-lien : changer le mode (invitations ↔ tous les liens)" },
    { value: "link_allow", label: "Anti-lien : salons où les liens restent autorisés" },
    { value: "mention_toggle", label: "Anti-mass-mention : activer/désactiver" },
    { value: "mention_threshold", label: "Anti-mass-mention : changer le seuil" },
    { value: "mention_timeout", label: "Anti-mass-mention : durée du timeout" },
    { value: "badwords_toggle", label: "Mots interdits : activer/désactiver" },
    { value: "badwords_add", label: "Mots interdits : ajouter un mot" },
    ...(words.length ? [{ value: "badwords_remove", label: "Mots interdits : retirer un mot" }] : []),
    { value: "scam_toggle", label: "Anti-scam : activer/désactiver" },
    ...(can(member, "protection.whitelist")
      ? [
          { value: "whitelist_add", label: "Whitelist : ajouter quelqu'un" },
          { value: "whitelist_remove", label: "Whitelist : retirer quelqu'un" },
        ]
      : []),
  ];

  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${CUSTOM_ID}:protectionaction`)
        .setPlaceholder("Choisir une action")
        .addOptions(options.map((o) => new StringSelectMenuOptionBuilder().setLabel(o.label.slice(0, 100)).setValue(o.value)))
    )
  );

  if (state.protectionAction === "badwords_add") {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${CUSTOM_ID}:badwords:add`).setLabel("Ouvrir la fenêtre d'ajout").setStyle(ButtonStyle.Secondary)
      )
    );
  } else if (state.protectionAction === "badwords_remove" && words.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${CUSTOM_ID}:badwords:del`)
          .setPlaceholder("Retirer un mot interdit")
          .addOptions(words.slice(0, 25).map((w) => new StringSelectMenuOptionBuilder().setLabel(w.slice(0, 100)).setValue(w)))
      )
    );
  } else if (state.protectionAction === "spam_exempt") {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${CUSTOM_ID}:spamexempt`)
          .setPlaceholder("Salons où l'anti-spam ne s'applique pas")
          .addChannelTypes(ChannelType.GuildText)
          .setMinValues(0)
          .setMaxValues(25)
          .setDefaultChannels(automod.getExemptChannels(guild.id).filter((id) => guild.channels.cache.has(id)).slice(0, 25))
      )
    );
  } else if (state.protectionAction === "link_allow") {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId(`${CUSTOM_ID}:linkallow`)
          .setPlaceholder("Salons où les liens restent autorisés")
          .addChannelTypes(ChannelType.GuildText)
          .setMinValues(0)
          .setMaxValues(25)
          .setDefaultChannels(antiLink.getAllowedChannels(guild.id).filter((id) => guild.channels.cache.has(id)).slice(0, 25))
      )
    );
  } else if (state.protectionAction === "whitelist_add") {
    rows.push(new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${CUSTOM_ID}:wladd`).setPlaceholder("Ajouter à la whitelist anti-spam")));
  } else if (state.protectionAction === "whitelist_remove") {
    rows.push(new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${CUSTOM_ID}:wldel`).setPlaceholder("Retirer de la whitelist anti-spam")));
  }
  return rows;
}

// ---- Vue Anti-nuke ----

function corpsGuard(guildId) {
  const config = guardConfig.getConfig(guildId);
  const whitelist = guardWhitelist.getWhitelist(guildId);
  const guardLines = ALL_GUARDS.filter((d) => d.key !== "creationlimit").map((d) => {
    const rule = d.threshold ? `${d.threshold.count}/${d.threshold.windowMs / 1000}s` : "immédiat";
    const on = guardConfig.isGuardEnabled(guildId, d.key);
    // Sanction EFFECTIVE de ce guard (propre ou globale) — affichée seulement
    // quand elle diffère de la globale, pour ne pas alourdir les 13 lignes.
    const sanction = guardConfig.getGuardPunishment(guildId, d.key);
    const suffixe = sanction !== config.punishment ? ` — **${sanction}**` : "";
    return `> ${on ? "🟢" : "🔴"} \`${d.key}\` (${rule})${suffixe}`;
  });
  return [
    `> **Anti-nuke** (interrupteur général) : ${config.enabled ? "activé" : "désactivé"}`,
    `> **Sanction** : ${config.punishment}${config.punishment === "timeout" ? ` (${config.punishmentDurationMs / 60000} min)` : ""}`,
    `> **Ping** : ${config.pingRoleId ? `<@&${config.pingRoleId}>` : "*aucun*"}`,
    `> **Anti-Fast (âge des comptes)** : ${config.antiFastEnabled ? "activé" : "désactivé"} — minimum ${config.antiFastMinAgeDays ? `${config.antiFastMinAgeDays} jour(s)` : "*non configuré*"}`,
    `> Anti-Fast est indépendant de l'interrupteur général Anti-nuke.`,
    `> **Verrouillage auto si plafond atteint** : ${config.autoLockdownOnCap ? "activé" : "désactivé"}`,
    `> **Whitelist** : ${mentions([...whitelist.users, ...whitelist.roles])}`,
    "",
    ...guardLines,
  ].join("\n");
}

function controlesGuard(guild, state) {
  const rows = [];
  const config = guardConfig.getConfig(guild.id);

  const options = [
    { value: "guard_toggle", label: config.enabled ? "Anti-nuke : désactiver" : "Anti-nuke : activer" },
    { value: "guard_punishment", label: "Changer la sanction globale (derank → timeout → kick → ban)" },
    { value: "guard_sanction", label: "Sanction par module (par protection)" },
    { value: "guard_pick", label: "Activer/désactiver un guard précis" },
    { value: "guard_wl_add", label: "Whitelist : ajouter quelqu'un" },
    { value: "guard_wl_remove", label: "Whitelist : retirer quelqu'un" },
    { value: "guard_wl_role_add", label: "Whitelist : ajouter un rôle" },
    { value: "guard_wl_role_remove", label: "Whitelist : retirer un rôle" },
    { value: "guard_ping", label: "Changer le rôle pingé" },
    { value: "antifast_toggle", label: config.antiFastEnabled ? "Anti-Fast : désactiver" : "Anti-Fast : activer" },
    { value: "antifast_config", label: "Changer le seuil de compte" },
    { value: "guard_autolockdown_toggle", label: config.autoLockdownOnCap ? "Verrouillage auto : désactiver" : "Verrouillage auto : activer" },
  ];

  rows.push(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${CUSTOM_ID}:guardaction`)
        .setPlaceholder("Choisir une action")
        .addOptions(options.map((o) => new StringSelectMenuOptionBuilder().setLabel(o.label.slice(0, 100)).setValue(o.value)))
    )
  );

  if (state.guardAction === "guard_pick") {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${CUSTOM_ID}:guardpick`)
          .setPlaceholder("Choisir un guard")
          .addOptions(
            ALL_GUARDS.map((d) =>
              new StringSelectMenuOptionBuilder().setLabel(d.label.slice(0, 100)).setDescription(d.key).setValue(d.key).setDefault(state.guardKey === d.key)
            )
          )
      )
    );
    if (state.guardKey) {
      const def = ALL_GUARDS.find((d) => d.key === state.guardKey);
      if (def) {
        const on = guardConfig.isGuardEnabled(guild.id, def.key);
        rows.push(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`${CUSTOM_ID}:guardtoggle:${def.key}`)
              .setLabel(`${def.label} : ${on ? "désactiver" : "activer"}`)
              .setStyle(on ? ButtonStyle.Danger : ButtonStyle.Success)
          )
        );
      }
    }
  } else if (state.guardAction === "guard_sanction") {
    // Sanction PAR MODULE (comme la capture) : choisir un guard, puis sa
    // sanction propre. "Sanction globale" remet le guard sur la sanction par
    // défaut du serveur.
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${CUSTOM_ID}:guardsanctionpick`)
          .setPlaceholder("Choisir une protection")
          .addOptions(
            ALL_GUARDS.map((d) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(d.label.slice(0, 100))
                .setDescription(`Sanction : ${guardConfig.getGuardPunishment(guild.id, d.key)}`)
                .setValue(d.key)
                .setDefault(state.guardKey === d.key)
            )
          )
      )
    );
    if (state.guardKey) {
      const def = ALL_GUARDS.find((d) => d.key === state.guardKey);
      if (def) {
        const actuelle = guardConfig.getGuardPunishment(guild.id, def.key);
        const boutons = ["derank", "timeout", "kick", "ban"].map((p) =>
          new ButtonBuilder()
            .setCustomId(`${CUSTOM_ID}:guardsanctionset:${def.key}:${p}`)
            .setLabel(p)
            .setStyle(p === actuelle ? ButtonStyle.Primary : ButtonStyle.Secondary)
        );
        rows.push(new ActionRowBuilder().addComponents(...boutons));
        rows.push(
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`${CUSTOM_ID}:guardsanctionset:${def.key}:global`)
              .setLabel("Sanction globale")
              .setStyle(ButtonStyle.Secondary)
          )
        );
      }
    }
  } else if (state.guardAction === "guard_wl_add") {
    rows.push(new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${CUSTOM_ID}:guardwladd`).setPlaceholder("Ajouter à la whitelist anti-nuke")));
  } else if (state.guardAction === "guard_wl_remove") {
    rows.push(new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${CUSTOM_ID}:guardwldel`).setPlaceholder("Retirer de la whitelist anti-nuke")));
  } else if (state.guardAction === "guard_wl_role_add") {
    rows.push(
      new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`${CUSTOM_ID}:guardwlroleadd`).setPlaceholder("Ajouter un rôle à la whitelist anti-nuke"))
    );
  } else if (state.guardAction === "guard_wl_role_remove") {
    rows.push(
      new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId(`${CUSTOM_ID}:guardwlroledel`).setPlaceholder("Retirer un rôle de la whitelist anti-nuke"))
    );
  } else if (state.guardAction === "guard_ping") {
    rows.push(
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`${CUSTOM_ID}:guardping`)
          .setPlaceholder("Rôle à pinguer (vide = aucun)")
          .setMinValues(0)
          .setDefaultRoles(config.pingRoleId && guild.roles.cache.has(config.pingRoleId) ? [config.pingRoleId] : [])
      )
    );
  } else if (state.guardAction === "antifast_config" || state.guardAction === "guard_creationlimit") {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_ID}:${state.guardAction === "antifast_config" ? "guardantifast" : "guardcreationlimit"}`)
          .setLabel("Régler l'âge minimum Anti-Fast (jours)")
          .setStyle(ButtonStyle.Secondary)
      )
    );
  }

  rows.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:guardall:on`).setLabel("Tout activer").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:guardall:off`).setLabel("Tout désactiver").setStyle(ButtonStyle.Danger)
    )
  );
  return rows;
}

// ---- Vue Mute ----

function corpsMute(guild) {
  const roleId = muteStore.getMuteRoleId(guild.id);
  return `> **Rôle de mute** : ${roleId && guild.roles.cache.has(roleId) ? `<@&${roleId}>` : "*aucun — non configuré*"}`;
}

function controlesMute(guild) {
  const roleId = muteStore.getMuteRoleId(guild.id);
  return [
    new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(`${CUSTOM_ID}:muterole`)
        .setPlaceholder("Choisir le rôle de mute (vide = aucun)")
        .setMinValues(0)
        .setDefaultRoles(roleId && guild.roles.cache.has(roleId) ? [roleId] : [])
    ),
  ];
}

// ---- Assemblage ----

function buildSecurityPanel(member, client, vue = "overview", state = {}) {
  const guild = member.guild;
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## 🛡️ Sécurité"));

  const stats = statsBot(client);
  const resume = [
    `${iconDe(guild.id, "OWNER")} **${accessStore.ownerIds().length}** propriétaire(s) · ${iconDe(guild.id, "CROWN")} **${accessStore.list("sys").length}** rang sys`,
    `🔇 **${compterMuted(guild)}** muet(s) (rôle de mute)`,
  ];
  if (stats) resume.push(`⏱️ **${stats.uptime}** · 📶 **${stats.ping}ms**`);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(resume.join("\n")));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(buildSubNav(vue));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  if (vue === "protection") {
    if (can(member, "protection.automod")) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Protection\n${corpsProtection(guild.id)}`));
      for (const row of controlesProtection(guild, member, state)) container.addActionRowComponents(row);
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Protection\n🔒 droit `protection.automod` requis"));
    }
  } else if (vue === "guard") {
    if (can(member, "protection.guard.manage")) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Anti-nuke\n${corpsGuard(guild.id)}`));
      for (const row of controlesGuard(guild, state)) container.addActionRowComponents(row);
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Anti-nuke\n🔒 droit `protection.guard.manage` requis"));
    }
  } else if (vue === "mute") {
    if (can(member, "protection.automod")) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Mute\n${corpsMute(guild)}`));
      for (const row of controlesMute(guild)) container.addActionRowComponents(row);
    } else {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Mute\n🔒 droit `protection.automod` requis"));
    }
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## Vue d'ensemble\n${corpsOverview(guild)}`));
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** "!!secur" — ouvre le panel (vue "overview"), réservé à qui a AU MOINS un des deux droits couverts. */
async function handleSecurityTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const { protection: PREFIX } = getPrefixes(message.guild.id);
  if (!PREFIX || !content.startsWith(PREFIX)) return;

  const [cmd] = content.slice(PREFIX.length).trim().split(/\s+/);
  if ((cmd || "").toLowerCase() !== "secur") return; // mot inconnu sur ce préfixe : silence, comme "&"

  if (!estAutorise(message.member)) {
    return message.reply("Tu n'as pas la permission nécessaire pour ouvrir ce panneau.").catch(() => {});
  }

  return message.channel.send(buildSecurityPanel(message.member, client)).catch((err) => {
    console.error("[securityPanel] échec de l'envoi du panneau :", err);
  });
}

/** Clics du panel — chaque action revérifie SA propre permission (elle a pu changer depuis l'ouverture). */
async function handleSecurityInteraction(interaction) {
  const [, action, extra] = interaction.customId.split(":");
  const guildId = interaction.guild.id;
  const guild = interaction.member.guild;
  const refuse = () => interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
  const goto = (vue, state) => interaction.update(buildSecurityPanel(interaction.member, interaction.client, vue, state));

  if (action === "subnav") {
    return goto(interaction.values[0]);
  }

  // ---- Protection ----

  if (action === "protectionaction") {
    const choice = interaction.values[0];
    const requiredPerm = choice.startsWith("whitelist_") ? "protection.whitelist" : "protection.automod";
    if (!can(interaction.member, requiredPerm)) return refuse();

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
      const paliers = [3, 5, 8, 10, 15, 20];
      const actuel = antiMention.getConfig(guildId).maxMentions;
      antiMention.setMaxMentions(guildId, paliers.find((n) => n > actuel) || paliers[0]);
      return goto("protection");
    }
    if (choice === "spam_threshold") {
      const paliers = [
        { maxMessages: 3, windowSeconds: 5 },
        { maxMessages: 5, windowSeconds: 6 },
        { maxMessages: 6, windowSeconds: 6 },
        { maxMessages: 8, windowSeconds: 10 },
        { maxMessages: 10, windowSeconds: 15 },
      ];
      const actuel = automod.getConfig(guildId);
      const suivant =
        paliers.find((p) => p.maxMessages > actuel.maxMessages || (p.maxMessages === actuel.maxMessages && p.windowSeconds > actuel.windowSeconds)) ||
        paliers[0];
      automod.setThreshold(guildId, suivant.maxMessages, suivant.windowSeconds);
      return goto("protection");
    }
    if (choice === "spam_timeout") {
      const paliers = [30, 60, 120, 300, 600, 1800];
      const actuel = automod.getConfig(guildId).timeoutSeconds;
      automod.setTimeoutSeconds(guildId, paliers.find((n) => n > actuel) || paliers[0]);
      return goto("protection");
    }
    if (choice === "mention_timeout") {
      const paliers = [30, 60, 120, 300, 600, 1800];
      const actuel = antiMention.getConfig(guildId).timeoutSeconds;
      antiMention.setTimeoutSeconds(guildId, paliers.find((n) => n > actuel) || paliers[0]);
      return goto("protection");
    }
    if (choice === "spam_exempt" || choice === "link_allow") {
      return goto("protection", { protectionAction: choice });
    }
    if (choice === "badwords_toggle") {
      badWords.setEnabled(guildId, !badWords.getConfig(guildId).enabled);
      return goto("protection");
    }
    if (choice === "scam_toggle") {
      antiScam.setEnabled(guildId, !antiScam.getConfig(guildId).enabled);
      return goto("protection");
    }
    // badwords_add / badwords_remove / whitelist_add / whitelist_remove : révèle le contrôle correspondant.
    return goto("protection", { protectionAction: choice });
  }

  if (action === "spamexempt" || action === "linkallow") {
    if (!can(interaction.member, "protection.automod")) return refuse();
    const choisis = interaction.values || [];
    if (action === "spamexempt") {
      for (const id of automod.getExemptChannels(guildId)) automod.setChannelExempt(guildId, id, false);
      for (const id of choisis) automod.setChannelExempt(guildId, id, true);
    } else {
      for (const id of antiLink.getAllowedChannels(guildId)) antiLink.setChannelAllowed(guildId, id, false);
      for (const id of choisis) antiLink.setChannelAllowed(guildId, id, true);
    }
    return goto("protection", { protectionAction: action === "spamexempt" ? "spam_exempt" : "link_allow" });
  }

  if (action === "wladd" || action === "wldel") {
    if (!can(interaction.member, "protection.whitelist")) return refuse();
    const userId = interaction.values[0];
    if (action === "wladd") automod.addToWhitelist(guildId, "users", userId);
    else automod.removeFromWhitelist(guildId, "users", userId);
    return goto("protection");
  }

  if (action === "badwords" && extra === "del") {
    if (!can(interaction.member, "protection.automod")) return refuse();
    badWords.removeWord(guildId, interaction.values[0]);
    return goto("protection");
  }

  if (action === "badwords" && extra === "add") {
    if (!can(interaction.member, "protection.automod")) return refuse();
    if (interaction.isModalSubmit()) {
      const word = interaction.fields.getTextInputValue("value").trim();
      if (!word) return interaction.reply({ content: "Mot vide, rien n'a été ajouté.", flags: MessageFlags.Ephemeral });
      const added = badWords.addWord(guildId, word);
      await interaction.reply({ content: added ? `\`${word}\` ajouté à la liste.` : "Ce mot y était déjà.", flags: MessageFlags.Ephemeral });
      return interaction.message?.edit(buildSecurityPanel(interaction.member, interaction.client, "protection")).catch(() => {});
    }
    const modal = new ModalBuilder().setCustomId(`${CUSTOM_ID}:badwords:add`).setTitle("Ajouter un mot interdit");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("value").setLabel("Mot à interdire").setStyle(TextInputStyle.Short).setMaxLength(100).setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  // ---- Anti-nuke ----

  if (action === "guardaction") {
    if (!can(interaction.member, "protection.guard.manage")) return refuse();
    const choice = interaction.values[0];
    if (choice === "guard_toggle") {
      guardConfig.setEnabled(guildId, !guardConfig.getConfig(guildId).enabled);
      return goto("guard");
    }
    if (choice === "guard_punishment") {
      const next = { derank: "timeout", timeout: "kick", kick: "ban", ban: "derank" }[guardConfig.getConfig(guildId).punishment];
      guardConfig.setPunishment(guildId, next);
      return goto("guard");
    }
    if (choice === "guard_autolockdown_toggle") {
      guardConfig.setAutoLockdown(guildId, !guardConfig.getConfig(guildId).autoLockdownOnCap);
      return goto("guard");
    }
    if (choice === "antifast_toggle") {
      guardConfig.setAntiFastEnabled(guildId, !guardConfig.getConfig(guildId).antiFastEnabled);
      return goto("guard");
    }
    return goto("guard", { guardAction: choice });
  }

  if (action === "guardpick") {
    if (!can(interaction.member, "protection.guard.manage")) return refuse();
    return goto("guard", { guardAction: "guard_pick", guardKey: interaction.values[0] });
  }

  if (action === "guardtoggle") {
    if (!can(interaction.member, "protection.guard.manage")) return refuse();
    guardConfig.toggleGuard(guildId, extra);
    return goto("guard", { guardAction: "guard_pick", guardKey: extra });
  }

  if (action === "guardsanctionpick") {
    if (!can(interaction.member, "protection.guard.manage")) return refuse();
    return goto("guard", { guardAction: "guard_sanction", guardKey: interaction.values[0] });
  }

  if (action === "guardsanctionset") {
    if (!can(interaction.member, "protection.guard.manage")) return refuse();
    // customId : "<CUSTOM_ID>:guardsanctionset:<guardKey>:<derank|timeout|kick|ban|global>"
    const [, , guardKey, choix] = interaction.customId.split(":");
    guardConfig.setGuardPunishment(guildId, guardKey, choix === "global" ? null : choix);
    return goto("guard", { guardAction: "guard_sanction", guardKey });
  }

  if (action === "guardwladd" || action === "guardwldel") {
    if (!can(interaction.member, "protection.guard.manage")) return refuse();
    const userId = interaction.values[0];
    if (action === "guardwladd") guardWhitelist.add(guildId, "users", userId);
    else guardWhitelist.remove(guildId, "users", userId);
    return goto("guard");
  }

  if (action === "guardwlroleadd" || action === "guardwlroledel") {
    if (!can(interaction.member, "protection.guard.manage")) return refuse();
    const roleId = interaction.values[0];
    if (action === "guardwlroleadd") guardWhitelist.add(guildId, "roles", roleId);
    else guardWhitelist.remove(guildId, "roles", roleId);
    return goto("guard");
  }

  if (action === "guardping") {
    if (!can(interaction.member, "protection.guard.manage")) return refuse();
    guardConfig.setPingRole(guildId, interaction.values[0] || null);
    return goto("guard");
  }

  if (action === "guardantifast") {
    if (!can(interaction.member, "protection.guard.manage")) return refuse();
    if (interaction.isModalSubmit()) {
      const raw = interaction.fields.getTextInputValue("days").trim();
      if (raw.toLowerCase() === "off") {
        guardConfig.setAntiFastEnabled(guildId, false);
        await interaction.reply({ content: "Anti-Fast désactivé.", flags: MessageFlags.Ephemeral });
        return interaction.message?.edit(buildSecurityPanel(interaction.member, interaction.client, "guard")).catch(() => {});
      }
      if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 3650) {
        return interaction.reply({ content: "Âge invalide — indique un nombre entier de jours (exemple : `7`).", flags: MessageFlags.Ephemeral });
      }
      guardConfig.setAntiFastMinAgeDays(guildId, Number(raw));
      await interaction.reply({ content: `Anti-Fast configuré : les comptes de moins de **${raw} jour(s)** seront expulsés à l'arrivée.`, flags: MessageFlags.Ephemeral });
      return interaction.message?.edit(buildSecurityPanel(interaction.member, interaction.client, "guard")).catch(() => {});
    }
    const modal = new ModalBuilder().setCustomId(`${CUSTOM_ID}:guardantifast`).setTitle("Configurer Anti-Fast");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("days")
          .setLabel('Âge minimum du compte (jours, entier) ou "off"')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(4)
          .setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  // Ancien customId conservé pour les panneaux déjà ouverts et les intégrations
  // utilisant `creationlimit`. Il alimente le même réglage Anti-Fast (aucune
  // seconde vérification d'âge).
  if (action === "guardcreationlimit") {
    if (!can(interaction.member, "protection.guard.manage")) return refuse();
    if (interaction.isModalSubmit()) {
      const raw = interaction.fields.getTextInputValue("duration").trim();
      if (!raw || raw.toLowerCase() === "off") {
        guardConfig.setCreationLimit(guildId, 0);
        await interaction.reply({ content: "Seuil de création de compte désactivé.", flags: MessageFlags.Ephemeral });
        return interaction.message?.edit(buildSecurityPanel(interaction.member, interaction.client, "guard")).catch(() => {});
      }
      const ms = parseDuration(raw);
      if (!ms) return interaction.reply({ content: "Durée invalide — exemple : `7d`, ou `off` pour désactiver.", flags: MessageFlags.Ephemeral });
      guardConfig.setCreationLimit(guildId, ms);
      await interaction.reply({ content: `Comptes créés il y a moins de **${raw}** sanctionnés à l'arrivée.`, flags: MessageFlags.Ephemeral });
      return interaction.message?.edit(buildSecurityPanel(interaction.member, interaction.client, "guard")).catch(() => {});
    }
    const modal = new ModalBuilder().setCustomId(`${CUSTOM_ID}:guardcreationlimit`).setTitle("Seuil de création de compte");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("duration").setLabel('Durée (ex: 7d, 12h) ou "off"').setStyle(TextInputStyle.Short).setMaxLength(20).setRequired(false)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "guardall") {
    if (!can(interaction.member, "protection.guard.manage")) return refuse();
    const activer = extra === "on";
    for (const g of ALL_GUARDS) guardConfig.setGuardEnabled(guildId, g.key, activer);
    return goto("guard");
  }

  // ---- Mute ----

  if (action === "muterole") {
    if (!can(interaction.member, "protection.automod")) return refuse();
    muteStore.setMuteRoleId(guildId, interaction.values[0] || null);
    return goto("mute");
  }
}

module.exports = { handleSecurityTextCommand, handleSecurityInteraction, CUSTOM_ID, buildSecurityPanel, estAutorise };
