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
    footer: "Tu dois être dans un salon vocal pour lancer une lecture.",
  });
}

// Commandes "-" accessibles à tout le monde, sans permission particulière.
function memberDashSection(prefix) {
  return {
    heading: "Membres",
    lines: [
      `\`${prefix}pic [@membre]\` — Affiche la photo de profil (la tienne par défaut)`,
      `\`${prefix}avatar [@membre]\` — Alias de ${prefix}pic`,
      `\`${prefix}snipe\` — Affiche le dernier message supprimé du salon`,
      `\`${prefix}clear me\` — Supprime tes propres messages récents (limite : 5 fois / 25 min)`,
      `\`uo clear\` (sans préfixe) — Alias de \`${prefix}clear me\``,
      `\`${prefix}ban\` — Ouvre le panel **Zinki Assassini** pour bannir un membre (admin, ou permission **Bannir des membres**)`,
      `\`${prefix}unban [id]\` — Débannit un membre (panel de sélection si l'ID n'est pas donné)`,
    ],
  };
}

// Commandes "-" réservées aux administrateurs par défaut (configurable via -panel).
function adminDashSections(prefix) {
  return [
    {
      heading: "Messages",
      lines: [
        `\`${prefix}clear <nombre>\` — Supprime les N derniers messages`,
        `\`${prefix}clear @membre\` ou \`${prefix}clear <id>\` — Supprime les messages récents d'un membre`,
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
    {
      heading: "Configuration",
      lines: [
        `\`${prefix}panel\` — Panel interactif : autoriser/interdire un rôle sur une commande, restreindre à des salons`,
      ],
    },
  ];
}

/**
 * Panel d'aide "-help" pour un membre sans permission particulière : ne
 * liste que les commandes qu'il peut réellement utiliser.
 * @param {string} prefix
 */
function buildMemberDashHelpPanel(prefix = "-") {
  return buildHelpPanel({
    title: "Aide — Commandes",
    intro: `Préfixe : \`${prefix}\` — commandes disponibles pour tout le monde.`,
    sections: [memberDashSection(prefix)],
  });
}

/**
 * Panel d'aide "-help" pour un administrateur : liste tout (commandes
 * membres + commandes de modération).
 * @param {string} prefix
 */
function buildAdminHelpPanel(prefix = "-") {
  return buildHelpPanel({
    title: "Aide — Commandes",
    intro: `Préfixe : \`${prefix}\` — en tant qu'administrateur, tu as accès à tout.`,
    sections: [memberDashSection(prefix), ...adminDashSections(prefix)],
    footer:
      "Les messages de plus de 14 jours ne peuvent pas être supprimés en masse (limite Discord).",
  });
}

module.exports = { buildMusicHelpPanel, buildMemberDashHelpPanel, buildAdminHelpPanel, buildHelpPanel };
