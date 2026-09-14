const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require("discord.js");

/**
 * Construit un panel d'aide en Components V2, sans couleur d'accent.
 * @param {{ title: string, intro: string, sections: Array<{ heading: string, lines: string[] }>, footer?: string }} options
 * @returns {{ flags: number, components: any[] }}
 */
function buildHelpPanel({ title, intro, sections, footer }) {
  const container = new ContainerBuilder();

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${title}\n${intro}`)
  );

  for (const section of sections) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
    );
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**${section.heading}**\n${section.lines.join("\n")}`
      )
    );
  }

  if (footer) {
    container.addSeparatorComponents(
      new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small)
    );
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));
  }

  return {
    flags: MessageFlags.IsComponentsV2,
    components: [container],
  };
}

/**
 * Panel d'aide des commandes musique (préfixe principal).
 * @param {string} prefix
 * @param {string} [modPrefix] — préfixe de gestion de ce bot
 * @param {{ moderation?: string, protection?: string, owner?: string }} [otherPrefixes]
 */
function buildMusicHelpPanel(prefix = "!", modPrefix, otherPrefixes = {}) {
  const moderation = otherPrefixes.moderation || "-";
  const protection = otherPrefixes.protection || "!!";
  const owner = otherPrefixes.owner || "=";
  return buildHelpPanel({
    title: "Aide — Commandes musique",
    intro: `Préfixe : \`${prefix}\``,
    sections: [
      {
        heading: "Lecture",
        lines: [
          `\`${prefix}play <recherche | lien YouTube/Spotify>\` — Joue un titre ou l'ajoute à la file`,
          `\`${prefix}join [@membre]\` — Rejoint et suit en direct ce que tu (ou @membre) écoutes sur Spotify`,
          `\`${prefix}pause\` — Met la lecture en pause`,
          `\`${prefix}resume\` — Reprend la lecture`,
          `\`${prefix}skip\` — Passe au titre suivant`,
          `\`${prefix}stop\` — Arrête tout et vide la file d'attente`,
          `\`${prefix}leave\` — Fait quitter le salon vocal au bot`,
        ],
      },
      {
        heading: "File d'attente & réglages",
        lines: [
          `\`${prefix}queue\` — Affiche la file d'attente`,
          `\`${prefix}volume <0-150>\` — Règle le volume`,
          `\`${prefix}loop off|song|queue\` — Change le mode de répétition`,
        ],
      },
    ],
    footer:
      "Tu dois être dans un salon vocal pour lancer une lecture. Seule la personne qui a amené le bot en vocal peut utiliser pause/resume/skip/stop/leave/volume/loop — les autres doivent lui demander la permission (un message avec Accepter/Refuser lui est envoyé automatiquement)." +
      (modPrefix
        ? `\nGestion : \`${modPrefix}\` (aide : \`${modPrefix}help\`). Modération : \`${moderation}\` (clear/ban/kick/mute...).` +
          `\nSécurité : \`${protection}\` (aide : \`${protection}help\`). Vocal/owner : \`${owner}\` (aide : \`${owner}help\`).`
        : ""),
  });
}

module.exports = { buildMusicHelpPanel, buildHelpPanel };
