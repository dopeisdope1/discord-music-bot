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
    footer:
      "Tu dois être dans un salon vocal pour lancer une lecture. Seule la personne qui a amené le bot en vocal peut utiliser pause/resume/skip/stop/leave/volume/loop — les autres doivent lui demander la permission (un message avec Accepter/Refuser lui est envoyé automatiquement).",
  });
}

// Commandes "." accessibles à tout le monde, sans permission particulière.
function memberDashSection(prefix) {
  return {
    heading: "Membres",
    lines: [
      `\`${prefix}pic [@membre]\` — Affiche la photo de profil (la tienne par défaut)`,
      `\`${prefix}avatar [@membre]\` — Alias de ${prefix}pic`,
      `\`${prefix}snipe\` — Affiche le dernier message supprimé du salon`,
      `\`${prefix}clear me\` — Supprime tes propres messages récents (limite : 5 fois / 25 min)`,
      `\`uo clear\` (sans préfixe) — Alias de \`${prefix}clear me\``,
      `\`${prefix}gif <recherche>\` — Envoie un gif aléatoire correspondant à la recherche`,
    ],
  };
}

// Commandes "." réservées à l'admin, la permission Discord "Bannir des
// membres", ou un rôle autorisé via `.panel` > Permissions (groupe "ban").
function banDashSection(prefix) {
  return {
    heading: "Modération — bannissement",
    lines: [
      `\`${prefix}ban\` — Ouvre le panel **Zinki Assassini** pour bannir un membre`,
      `\`${prefix}unban [id]\` — Ouvre le panel **Zinki Assassini** pour débannir un membre (menu déroulant si l'ID n'est pas donné)`,
      `\`/ban\` / \`/unban\` — Mêmes permissions, mais avec recherche en direct (tape et ça filtre, sans liste avant de taper)`,
    ],
  };
}

// Commandes "." réservées à l'admin, ou un rôle autorisé via `.panel` >
// Permissions (groupe "mod").
function modDashSections(prefix) {
  return [
    {
      heading: "Messages",
      lines: [
        `\`${prefix}clear <nombre>\` — Supprime les N derniers messages`,
        `\`${prefix}clear @membre\` ou \`${prefix}clear <id>\` — Supprime les messages récents d'un membre`,
      ],
    },
    {
      heading: "Réglages",
      lines: [
        `\`${prefix}panel\` — Panel à 3 pages : Préfixes du bot, salons de logs (modération/salon/rôles), et Permissions (autoriser des rôles à utiliser ces commandes, + gérer les rôles en masse)`,
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
        `\`${prefix}massrole add|remove @role\`/\`<id>\` — Ajoute/retire un rôle à tous les membres (utilise l'ID pour ne pas ping tout le rôle)`,
      ],
    },
    {
      heading: "Emoji",
      lines: [
        `\`${prefix}create <nom> <url>\` — Crée un emoji sur le serveur à partir d'un lien d'image`,
        `\`${prefix}create <nom>\` (avec une image en pièce jointe) — Idem, à partir du fichier envoyé`,
      ],
    },
  ];
}

/**
 * Panel d'aide "-help" : ne liste que les commandes que l'auteur peut
 * réellement utiliser, en fonction de ses permissions réelles (admin,
 * permission Discord "Bannir des membres", ou rôle autorisé via `.panel` >
 * Permissions) — pas juste un binaire admin/non-admin, puisque les rôles
 * "mod" et "ban" peuvent maintenant être accordés séparément.
 * @param {string} prefix
 * @param {{ hasMod: boolean, hasBan: boolean }} perms
 */
function buildDashHelpPanel(prefix, { hasMod, hasBan }) {
  const sections = [memberDashSection(prefix)];
  if (hasBan) sections.push(banDashSection(prefix));
  if (hasMod) sections.push(...modDashSections(prefix));

  return buildHelpPanel({
    title: "Aide — Commandes",
    intro: `Préfixe : \`${prefix}\` — commandes disponibles pour toi ci-dessous.`,
    sections,
    footer: hasMod
      ? "Les messages de plus de 14 jours ne peuvent pas être supprimés en masse (limite Discord)."
      : undefined,
  });
}

module.exports = { buildMusicHelpPanel, buildDashHelpPanel, buildHelpPanel };
