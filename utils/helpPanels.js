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
      "Tu dois être dans un salon vocal pour lancer une lecture. Seule la personne qui a amené le bot en vocal peut utiliser pause/resume/skip/stop/leave/volume/loop — les autres doivent lui demander la permission (un message avec Accepter/Refuser lui est envoyé automatiquement).",
  });
}

// Commandes "." accessibles à tout le monde, sans permission particulière.
function memberDashSection(prefix) {
  return {
    heading: "Membres",
    lines: [
      `\`${prefix}pic\`/\`${prefix}avatar [@membre]\` — Photo de profil (toi par défaut)`,
      `\`${prefix}snipe\` — Dernier message supprimé du salon`,
      `\`${prefix}clear me\` (ou \`uo clear\`) — Supprime tes messages récents (5×/25 min)`,
      `\`${prefix}gif <recherche>\` — Envoie un gif`,
    ],
  };
}

// Commandes "." réservées à l'admin, la permission Discord "Bannir des
// membres", ou un rôle autorisé via `.panel` > Permissions (groupe "ban").
function banDashSection(prefix) {
  return {
    heading: "Bannissement",
    lines: [
      `\`${prefix}ban\` — Panel **Zinki Assassini** pour bannir un membre`,
      `\`${prefix}unban [id]\` — Idem pour débannir (ou direct par ID)`,
      `\`${prefix}unbanall\` — Débannit tout le monde (confirmation demandée)`,
    ],
  };
}

// Commande "." réservée aux VRAIS administrateurs uniquement (pas extensible
// via un rôle `.panel` > Permissions — trop destructrice).
function dangerDashSection(prefix) {
  return {
    heading: "⚠️ Danger",
    lines: [`\`${prefix}banall\` — Bannit tout le monde sauf toi (confirmation demandée, irréversible)`],
  };
}

// Commandes "." réservées à l'admin, ou un rôle autorisé via `.panel` >
// Permissions (groupe "mod").
function modDashSections(prefix) {
  return [
    {
      heading: "Modération",
      lines: [
        `\`${prefix}clear <nombre>\`/\`@membre\`/\`<id>\` — Supprime des messages`,
        `\`${prefix}panel\` — Config du bot (préfixes, logs, permissions, rôles)`,
        `\`${prefix}renew\` — Recrée le salon (vide)`,
        `\`${prefix}hide\`/\`${prefix}unhide\` — Cache/affiche le salon à @everyone`,
        `\`${prefix}lock\`/\`${prefix}unlock\` — Bloque/débloque l'écriture pour @everyone`,
        `\`${prefix}massrole add|remove @role\` — Rôle en masse (utilise l'ID pour ne pas ping)`,
        `\`${prefix}create <nom> <url ou pièce jointe>\` — Crée un emoji`,
      ],
    },
  ];
}

/**
 * Panel d'aide "-help" : ne liste que les commandes que l'auteur peut
 * réellement utiliser, en fonction de ses permissions réelles (admin,
 * permission Discord "Bannir des membres", ou rôle autorisé via `.panel` >
 * Permissions) — pas juste un binaire admin/non-admin, puisque les rôles
 * "mod" et "ban" peuvent maintenant être accordés séparément. `.banall` n'est
 * listée que pour un vrai administrateur (isAdmin), jamais pour un simple
 * rôle "mod" autorisé — voir dangerDashSection.
 * @param {string} prefix
 * @param {{ hasMod: boolean, hasBan: boolean, isAdmin: boolean }} perms
 */
function buildDashHelpPanel(prefix, { hasMod, hasBan, isAdmin }) {
  const sections = [memberDashSection(prefix)];
  if (hasBan) sections.push(banDashSection(prefix));
  if (hasMod) sections.push(...modDashSections(prefix));
  if (isAdmin) sections.push(dangerDashSection(prefix));

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
