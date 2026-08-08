const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require("discord.js");
const { MOD_ROLE_NAME } = require("./permissions");

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
 */
function buildMusicHelpPanel(prefix = "!") {
  return buildHelpPanel({
    title: "Aide — Commandes musique",
    intro: `Préfixe : \`${prefix}\` — les commandes slash \`/\` équivalentes existent aussi.`,
    sections: [
      {
        heading: "Lecture",
        lines: [
          `\`${prefix}play <recherche | lien YouTube/Spotify>\` — Joue un titre ou l'ajoute à la file`,
          `\`${prefix}join\` — Rejoint et joue ce que tu écoutes actuellement sur Spotify`,
          `\`${prefix}pause\` — Met la lecture en pause`,
          `\`${prefix}resume\` — Reprend la lecture`,
          `\`${prefix}skip\` — Passe au titre suivant`,
          `\`${prefix}stop\` — Arrête tout et vide la file d'attente`,
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
    footer: "Tu dois être dans un salon vocal pour lancer une lecture.",
  });
}

/**
 * Panel d'aide des commandes de modération (préfixe "-").
 * @param {string} prefix
 */
function buildAdminHelpPanel(prefix = "-") {
  return buildHelpPanel({
    title: "Aide — Commandes de modération",
    intro: `Préfixe : \`${prefix}\` — réservé au rôle **${MOD_ROLE_NAME}** (et aux administrateurs).`,
    sections: [
      {
        heading: "Messages",
        lines: [
          `\`${prefix}clear <nombre>\` — Supprime les N derniers messages`,
          `\`${prefix}clear @membre\` — Supprime les messages récents d'un membre`,
          `\`${prefix}snipe\` — Affiche le dernier message supprimé du salon`,
        ],
      },
      {
        heading: "Salon",
        lines: [
          `\`${prefix}renew\` — Recrée le salon à l'identique (vide)`,
          `\`${prefix}hide\` — Cache le salon à @everyone`,
          `\`${prefix}unhide\` — Rend le salon visible à @everyone`,
          `\`${prefix}lock\` — Empêche @everyone d'écrire dans le salon`,
          `\`${prefix}unlock\` — Autorise de nouveau @everyone à écrire`,
        ],
      },
    ],
    footer:
      "Les messages de plus de 14 jours ne peuvent pas être supprimés en masse (limite Discord).",
  });
}

module.exports = { buildMusicHelpPanel, buildAdminHelpPanel, buildHelpPanel };
