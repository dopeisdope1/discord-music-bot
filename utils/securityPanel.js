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
  MessageFlags,
} = require("discord.js");
const { EMOJI } = require("./emojis");
const { getPrefixes } = require("./prefixStore");
const { can } = require("./permissions/engine");
const accessStore = require("./accessStore");
const muteStore = require("./muteStore");
const guardConfig = require("./guard/config");
const { ALL_GUARDS } = require("./guard/definitions");
const { computeStatus, formatUptime } = require("./statusDiagnostic");
const automod = require("./automod/antiSpam");
const antiLink = require("./automod/antiLink");
const antiMention = require("./automod/antiMention");
const badWords = require("./automod/badWords");

// "!!secur" — tout ce qui concerne la sécurité DU SERVEUR (par opposition à
// "!!panel", strictement personnel — voir utils/personalProtection.js) :
// résumé (propriétaires/rang sys/mutes/uptime/ping), Sécurité serveur
// (antispam/antilien/antimention/mots interdits, mêmes magasins que
// &panel > Protection) et Anti-nuke (utils/guard/*.js, mêmes magasins que
// &panel > Anti-nuke). Toujours des données/fonctions RÉELLES, jamais
// inventées. Demande explicite : "une commande pour panel perso et une
// commande avec tout les truc de securité etc" — scission de l'ancien
// !!panel à deux pages.
const CUSTOM_ID = "secur";

// Mêmes 4 interrupteurs que &panel > Protection, mêmes magasins.
const SERVEUR_TOGGLES = [
  { key: "antiSpam", label: "Anti-Spam/Flood", store: automod },
  { key: "antiLien", label: "Anti-Lien", store: antiLink },
  { key: "antiMassMention", label: "Anti-Mass-Mention", store: antiMention },
  { key: "motsInterdits", label: "Mots interdits", store: badWords },
];

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

function buildSecurityPanel(member, client) {
  const guild = member.guild;
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## 🛡️ Sécurité"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  const stats = statsBot(client);
  const resume = [
    `${EMOJI.OWNER} **${accessStore.ownerIds().length}** propriétaire(s) · ${EMOJI.CROWN} **${accessStore.list("sys").length}** rang sys`,
    `🔇 **${compterMuted(guild)}** muet(s) (rôle de mute)`,
  ];
  if (stats) resume.push(`⏱️ **${stats.uptime}** · 📶 **${stats.ping}ms**`);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(resume.join("\n")));

  const droitServeur = can(member, "protection.automod");
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  if (droitServeur) {
    const onSrv = SERVEUR_TOGGLES.filter((t) => t.store.getConfig(guild.id).enabled).length;
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`## 🛡️ Sécurité serveur — ${onSrv}/${SERVEUR_TOGGLES.length} actives`)
    );
    const boutonsServeur = SERVEUR_TOGGLES.map((t) => {
      const actif = t.store.getConfig(guild.id).enabled;
      return new ButtonBuilder()
        .setCustomId(`${CUSTOM_ID}:srv:${t.key}`)
        .setLabel(`${t.label} — ${actif ? "ON" : "OFF"}`)
        .setStyle(actif ? ButtonStyle.Success : ButtonStyle.Secondary);
    });
    for (let i = 0; i < boutonsServeur.length; i += 5) {
      container.addActionRowComponents(new ActionRowBuilder().addComponents(boutonsServeur.slice(i, i + 5)));
    }
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## 🛡️ Sécurité serveur\n🔒 droit `protection.automod` requis")
    );
  }

  const droitGuard = can(member, "protection.guard.manage");
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  if (droitGuard) {
    const configGuard = guardConfig.getConfig(guild.id);
    const onGuard = ALL_GUARDS.filter((g) => guardConfig.isGuardEnabled(guild.id, g.key)).length;
    const lignes = [
      `## 🛡️ Anti-nuke — ${onGuard}/${ALL_GUARDS.length} actives${
        configGuard.enabled ? "" : " (⚠️ interrupteur général éteint — &panel > Anti-nuke)"
      }`,
    ];
    for (let i = 0; i < ALL_GUARDS.length; i += 2) {
      const a = ALL_GUARDS[i];
      const b = ALL_GUARDS[i + 1];
      const texteA = `${guardConfig.isGuardEnabled(guild.id, a.key) ? EMOJI.CHECK : EMOJI.CROSS} \`${a.key}\``;
      const texteB = b ? ` · ${guardConfig.isGuardEnabled(guild.id, b.key) ? EMOJI.CHECK : EMOJI.CROSS} \`${b.key}\`` : "";
      lignes.push(`${texteA}${texteB}`);
    }
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lignes.join("\n")));

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
  } else {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("## 🛡️ Anti-nuke\n🔒 droit `protection.guard.manage` requis")
    );
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** "!!secur" — ouvre le panel, réservé à qui a AU MOINS un des deux droits couverts. */
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
  const [, action, key] = interaction.customId.split(":");

  if (action === "srv") {
    const cible = SERVEUR_TOGGLES.find((t) => t.key === key);
    if (!cible) return;
    if (!can(interaction.member, "protection.automod")) {
      return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    }
    cible.store.setEnabled(interaction.guild.id, !cible.store.getConfig(interaction.guild.id).enabled);
    return interaction.update(buildSecurityPanel(interaction.member, interaction.client));
  }

  if (action === "guardpick") {
    if (!can(interaction.member, "protection.guard.manage")) {
      return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    }
    const guardKey = interaction.values[0];
    if (!ALL_GUARDS.some((g) => g.key === guardKey)) return;
    guardConfig.toggleGuard(interaction.guild.id, guardKey);
    return interaction.update(buildSecurityPanel(interaction.member, interaction.client));
  }

  if (action === "guardall") {
    if (!can(interaction.member, "protection.guard.manage")) {
      return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
    }
    const activer = key === "on";
    for (const g of ALL_GUARDS) guardConfig.setGuardEnabled(interaction.guild.id, g.key, activer);
    return interaction.update(buildSecurityPanel(interaction.member, interaction.client));
  }
}

module.exports = { handleSecurityTextCommand, handleSecurityInteraction, CUSTOM_ID };
