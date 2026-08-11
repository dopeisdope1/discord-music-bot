const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const { canUseCommand } = require("./permissions");

const HELP_TIMEOUT_MS = 5 * 60_000;

// Commandes de modération gardées, gérées via canUseCommand (Administrateur
// natif, ou permission Discord native "Bannir des membres" pour ban/unban/
// unbanall uniquement — voir utils/permissions.js).
const MODERATION_COMMANDS = ["renew", "hide", "unhide", "lock", "unlock", "massrole", "panel", "create", "clear", "add", "del"];
const BAN_COMMAND_NAMES = ["ban", "unban", "unbanall"];

// Description affichée par commande dans `.help`.
function assignableCommandLine(prefix, cmd) {
  const lines = {
    panel: `\`${prefix}panel\` — Config du bot (préfixes, logs)`,
    renew: `\`${prefix}renew\` — Recrée le salon (vide)`,
    hide: `\`${prefix}hide\` — Cache le salon à @everyone`,
    unhide: `\`${prefix}unhide\` — Affiche le salon à @everyone`,
    lock: `\`${prefix}lock\` — Bloque l'écriture pour @everyone`,
    unlock: `\`${prefix}unlock\` — Débloque l'écriture pour @everyone`,
    massrole: `\`${prefix}massrole add|remove @role\` — Rôle en masse (utilise l'ID pour ne pas ping)`,
    add: "`add <nom du rôle>` (en réponse au message du membre, ou en le mentionnant) — Ajoute ce rôle",
    del: "`del <nom du rôle>` (en réponse au message du membre, ou en le mentionnant) — Retire ce rôle",
    create: `\`${prefix}create <nom> <url ou pièce jointe>\` — Crée un emoji`,
    ban: `\`${prefix}ban\` — Panel **Zinki Assassini** pour bannir un membre`,
    unban: `\`${prefix}unban [id]\` — Idem pour débannir (ou direct par ID)`,
    unbanall: `\`${prefix}unbanall\` — Débannit tout le monde (confirmation demandée)`,
    clear: `\`${prefix}clear <nombre>\`/\`@membre\`/\`<id>\` — Supprime des messages`,
  };
  return lines[cmd] || `\`${prefix}${cmd}\``;
}

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
 * @param {string} [modPrefix] — préfixe des commandes de modération dupliquées sur ce bot (voir utils/musicModerationCommands.js)
 */
function buildMusicHelpPanel(prefix = "!", modPrefix) {
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
        ? `\nCe bot gère aussi des commandes de modération (clear/ban/renew/lock...) sur un préfixe séparé — tape \`${modPrefix}help\` pour les voir.`
        : ""),
  });
}

/**
 * Catégories du panel d'aide "-help", construites commande par commande via
 * canUseCommand : chaque commande de modération n'apparaît que si l'auteur y
 * a réellement accès (administrateur, ou permission Discord native pour
 * ban/unban/unbanall). Deux personnes avec des permissions différentes
 * voient donc des listes différentes. "⚠️ Danger" (`.banall`) n'apparaît que
 * pour un administrateur.
 * @param {string} prefix
 * @param {import('discord.js').Message} message
 * @param {{ includePublic?: boolean, moderationCommands?: string[] }} [options]
 *   includePublic: inclut pic/avatar/snipe/gif (absentes du sous-ensemble
 *   dupliqué sur le bot Musique) ; moderationCommands: liste des commandes
 *   de modération réellement disponibles sur CE bot (voir
 *   utils/musicModerationCommands.js pour un sous-ensemble réduit).
 */
function buildDashCategories(prefix, message, { includePublic = true, moderationCommands = MODERATION_COMMANDS } = {}) {
  const categories = [];

  if (includePublic) {
    categories.push({
      key: "public",
      label: "Commandes publiques",
      names: ["pic", "avatar", "snipe", "clear me", "gif"],
      lines: [
        `\`${prefix}pic\`/\`${prefix}avatar [@membre]\` — Photo de profil (toi par défaut)`,
        `\`${prefix}snipe\` — Dernier message supprimé du salon`,
        `\`${prefix}clear me\` (ou \`uo clear\`) — Supprime tes messages récents (5×/25 min)`,
        `\`${prefix}gif <recherche>\` — Envoie un gif`,
      ],
    });
  }

  const allowed = [...moderationCommands, ...BAN_COMMAND_NAMES].filter((cmd) => canUseCommand(message, cmd));
  if (allowed.length) {
    categories.push({
      key: "allowed",
      label: "Commandes autorisées",
      names: allowed,
      lines: allowed.map((cmd) => assignableCommandLine(prefix, cmd)),
      footer: allowed.includes("clear")
        ? "Les messages de plus de 14 jours ne peuvent pas être supprimés en masse (limite Discord)."
        : undefined,
    });
  }

  if (message.member?.permissions.has(PermissionFlagsBits.Administrator)) {
    categories.push({
      key: "danger",
      label: "⚠️ Danger",
      names: ["banall"],
      lines: [`\`${prefix}banall\` — Bannit tout le monde sauf toi (confirmation demandée, irréversible)`],
    });
  }

  return categories;
}

function buildCategorySelect(categories, selectedKey) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("help_category")
      .setPlaceholder("Naviguer vers une catégorie")
      .addOptions(categories.map((c) => ({ label: c.label, value: c.key, default: c.key === selectedKey })))
  );
}

function buildHelpOverview(categories) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Aide — Commandes\n" +
        "Sélectionne une catégorie dans le menu ci-dessous pour voir ses commandes.\n" +
        "Les arguments entre `[]` sont facultatifs, ceux entre `<>` sont obligatoires."
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      categories.map((c) => `**${c.label} (${c.names.length})** : ${c.names.join(", ")}`).join("\n")
    )
  );
  container.addActionRowComponents(buildCategorySelect(categories));
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildHelpCategoryPanel(categories, key) {
  const category = categories.find((c) => c.key === key) || categories[0];
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(`## ${category.label}\n${category.lines.join("\n")}`)
  );
  if (category.footer) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(category.footer));
  }
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(buildCategorySelect(categories, category.key));
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Envoie le panel d'aide "-help" interactif : un écran d'accueil qui résume
 * chaque catégorie (nom des commandes), puis un menu déroulant pour naviguer
 * dedans sans tout afficher d'un coup — voir buildDashCategories pour le
 * filtrage par permission (commande par commande, propre à l'auteur) et pour
 * les options permettant de réutiliser ce panel sur un sous-ensemble réduit
 * de commandes (voir utils/musicModerationCommands.js).
 * @param {import('discord.js').Message} message
 * @param {string} prefix
 * @param {{ includePublic?: boolean, moderationCommands?: string[] }} [options]
 */
async function sendDashHelpPanel(message, prefix, options) {
  const categories = buildDashCategories(prefix, message, options);
  const panelMessage = await message.reply(buildHelpOverview(categories));

  const collector = panelMessage.createMessageComponentCollector({ time: HELP_TIMEOUT_MS });

  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== message.author.id) {
        await i.reply({ content: "Seul l'auteur de la commande peut naviguer dans ce menu.", ephemeral: true });
        return;
      }
      if (!i.isStringSelectMenu() || i.customId !== "help_category") return;
      await i.update(buildHelpCategoryPanel(categories, i.values[0]));
    } catch (err) {
      console.error("[help] Erreur dans le panel d'aide :", err);
    }
  });

  collector.on("end", () => {
    panelMessage.edit({ components: [] }).catch(() => {});
  });
}

module.exports = { buildMusicHelpPanel, sendDashHelpPanel, buildHelpPanel };
