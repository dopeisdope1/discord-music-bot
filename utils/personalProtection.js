const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require("discord.js");
const { EMOJI } = require("./emojis");
const store = require("./personalProtectionStore");
const messageOwner = require("./messageOwner");
const { getPrefixes } = require("./prefixStore");

// !!panel — panel de protection PERSONNELLE, sur un préfixe séparé exprès
// pour ne jamais se mélanger avec &panel (configuration du SERVEUR, voir
// utils/configPanel.js). "Ça te concerne toi seul" : chaque bouton
// active/désactive une protection pour la personne qui clique, aucun effet
// sur le reste du serveur — voir utils/personalProtectionStore.js pour la
// liste des protections et utils/roleLimitStore.js/index.js pour
// l'application réelle (guildMemberUpdate).
//
// V1 volontairement réduite à UNE protection (Anti-Retrait Rôle) : c'est la
// seule des captures fournies qui se détecte et se corrige sans ambiguïté
// (un membre ne peut jamais retirer son propre rôle — la réappliquer ne
// risque donc jamais d'annuler une action volontaire de la personne
// elle-même, contrairement à un renommage ou un mute qu'elle pourrait avoir
// voulu). Les autres (anti-mute/deafen, anti-timeout, anti-ban, anti-kick
// "sanction auteur"...) demandent chacune leur propre mécanique et sont
// volontairement laissées pour une prochaine passe.

const CUSTOM_ID = "prot";

function buildPanel(member) {
  const settings = store.getSettings(member.guild.id, member.id);
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${EMOJI.LOCK} Panel perso`));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("Ça te concerne **toi seul** — le reste du serveur n'est pas touché.")
  );

  const boutons = Object.entries(store.PROTECTIONS).map(([key, def]) => {
    const actif = settings[key];
    return new ButtonBuilder()
      .setCustomId(`${CUSTOM_ID}:toggle:${key}`)
      .setLabel(`${def.label} — ${actif ? "ON" : "OFF"}`)
      .setStyle(actif ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji(actif ? EMOJI.CHECK : EMOJI.CROSS);
  });
  container.addActionRowComponents(new ActionRowBuilder().addComponents(boutons));

  const lignes = Object.entries(store.PROTECTIONS).map(
    ([key, def]) => `${settings[key] ? EMOJI.CHECK : EMOJI.CROSS} **${def.label}** — ${def.description}`
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lignes.join("\n")));

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
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

  return messageOwner.repondreEtRetenir(message, buildPanel(message.member));
}

/**
 * Clic sur un bouton "prot:toggle:<clé>" — voir index.js pour le routage par
 * customId. La propriété du panneau (seul l'auteur peut cliquer) est déjà
 * vérifiée en amont dans index.js, comme pour "cfg:" — pas besoin de la
 * revérifier ici.
 */
async function handleProtectionInteraction(interaction) {
  const [, action, key] = interaction.customId.split(":");
  if (action !== "toggle") return;

  store.toggle(interaction.guild.id, interaction.user.id, key);
  return interaction.update(buildPanel(interaction.member));
}

/**
 * Anti-Retrait Rôle — appelé depuis index.js sur guildMemberUpdate. Compare
 * les rôles avant/après et réapplique ceux qui ont disparu pour un membre
 * protégé. Un rôle SUPPRIMÉ du serveur entre-temps (plus dans le cache) est
 * ignoré plutôt que de faire échouer le reste.
 */
async function enforceRoleProtection(oldMember, newMember) {
  if (!store.isEnabled(newMember.guild.id, newMember.id, "antiRoleRemove")) return;
  const perdus = [...oldMember.roles.cache.values()].filter((r) => !newMember.roles.cache.has(r.id) && newMember.guild.roles.cache.has(r.id));
  if (!perdus.length) return;
  await newMember.roles.add(perdus, "Anti-Retrait Rôle (!!panel)").catch((err) => {
    console.error("[personalProtection] réapplication de rôle impossible :", err.message);
  });
}

module.exports = { handleProtectionTextCommand, handleProtectionInteraction, enforceRoleProtection, CUSTOM_ID };
