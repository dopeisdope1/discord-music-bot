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
const { DELEGABLE_COMMANDS } = require("./commandPermissionStore");

const HELP_TIMEOUT_MS = 5 * 60_000;

// Commandes de modération gardées, gérées via canUseCommand (Administrateur
// natif, ou permission Discord native "Bannir des membres" pour ban/unban/
// unbanall uniquement — voir utils/permissions.js).
const MODERATION_COMMANDS = [
  "renew",
  "hide",
  "unhide",
  "lock",
  "unlock",
  "massrole",
  "panel",
  "create",
  "clear",
  "add",
  "del",
  "greet",
  "addbienvenue",
  "delbienvenue",
  "listbienvenue",
  "perms",
  "helpall",
  "say",
];
const BAN_COMMAND_NAMES = ["ban", "unban", "unbanall"];

// Description affichée par commande dans `&help` — format "`cmd` (description)".
function assignableCommandLine(prefix, cmd) {
  const lines = {
    help: `\`${prefix}help\` (Affiche la liste des commandes en fonction de tes permissions)`,
    panel: `\`${prefix}panel\` (Configuration du bot : préfixes, permissions, paliers, bienvenue)`,
    renew: `\`${prefix}renew\` (Recrée le salon actuel, vide)`,
    hide: `\`${prefix}hide\` (Cache le salon à @everyone)`,
    unhide: `\`${prefix}unhide\` (Affiche le salon à @everyone)`,
    lock: `\`${prefix}lock\` (Bloque l'écriture pour @everyone)`,
    unlock: `\`${prefix}unlock\` (Débloque l'écriture pour @everyone)`,
    massrole: `\`${prefix}massrole add|remove @role\` (Ajoute/retire un rôle en masse)`,
    add: "`add <rôle>` (en réponse à un membre ou en le mentionnant — Ajoute ce rôle)",
    del: "`del <rôle>` (en réponse à un membre ou en le mentionnant — Retire ce rôle)",
    create: `\`${prefix}create <nom> <url ou pièce jointe>\` (Crée un emoji)`,
    ban: `\`${prefix}ban\` (Panel pour bannir un membre)`,
    unban: `\`${prefix}unban [id]\` (Débannit un membre)`,
    unbanall: `\`${prefix}unbanall\` (Débannit tout le monde, confirmation demandée)`,
    clear: `\`${prefix}clear <nombre>\`/\`@membre\` (Supprime des messages d'un salon ou d'un membre)`,
    greet: `\`${prefix}greet #salon\` (Définit le salon des messages de bienvenue)`,
    addbienvenue: `\`${prefix}addbienvenue <texte>\` (Ajoute un message de bienvenue)`,
    delbienvenue: `\`${prefix}delbienvenue <numéro>\` (Retire un message de bienvenue)`,
    listbienvenue: `\`${prefix}listbienvenue\` (Liste les messages de bienvenue et le salon configuré)`,
    perms: `\`${prefix}perms\` (Affiche les rôles liés à chaque permission)`,
    helpall: `\`${prefix}helpall\` (Affiche les commandes liées à chaque permission)`,
    say: `\`${prefix}say <texte>\` (Fait parler le bot à ta place — réservé au propriétaire du bot)`,
    banall: `\`${prefix}banall\` (Bannit tout le monde sauf toi, confirmation demandée)`,
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
 * Catégories du panel d'aide "&help", dans le style Public / Sanction /
 * Owner : Public est toujours visible, Sanction regroupe les commandes
 * délégables à un rôle (voir DELEGABLE_COMMANDS, utils/commandPermissionStore.js),
 * Owner les commandes réservées aux administrateurs natifs (jamais
 * délégables : panel/perms/helpall/say/banall). Chaque commande de
 * modération n'apparaît que si l'auteur y a réellement accès (canUseCommand)
 * — deux personnes avec des permissions différentes voient donc des listes
 * différentes.
 * @param {string} prefix
 * @param {import('discord.js').Message} message
 * @param {{ moderationCommands?: string[] }} [options] moderationCommands :
 *   liste des commandes de modération réellement disponibles sur ce bot.
 */
function buildDashCategories(prefix, message, { moderationCommands = MODERATION_COMMANDS } = {}) {
  const categories = [
    {
      key: "public",
      label: "Public",
      names: ["help"],
      lines: [assignableCommandLine(prefix, "help")],
    },
  ];

  const allCommands = [...moderationCommands, ...BAN_COMMAND_NAMES];

  const sanction = allCommands.filter((cmd) => DELEGABLE_COMMANDS.includes(cmd) && canUseCommand(message, cmd));
  if (sanction.length) {
    categories.push({
      key: "sanction",
      label: "Sanction",
      names: sanction,
      lines: sanction.map((cmd) => assignableCommandLine(prefix, cmd)),
      footer: sanction.includes("clear")
        ? "Les messages de plus de 14 jours ne peuvent pas être supprimés en masse (limite Discord)."
        : undefined,
    });
  }

  const owner = allCommands.filter((cmd) => !DELEGABLE_COMMANDS.includes(cmd) && canUseCommand(message, cmd));
  if (message.member?.permissions.has(PermissionFlagsBits.Administrator)) owner.push("banall");
  if (owner.length) {
    categories.push({
      key: "owner",
      label: "Owner",
      names: owner,
      lines: owner.map((cmd) => assignableCommandLine(prefix, cmd)),
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
      "## Page d'aide\n" +
        "Permet de voir la liste des commandes en fonction de tes permissions sur le bot.\n" +
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
 * Envoie le panel d'aide "&help" interactif : un écran d'accueil qui résume
 * chaque catégorie (Public/Sanction/Owner, nom des commandes), puis un menu
 * déroulant pour naviguer dedans sans tout afficher d'un coup — voir
 * buildDashCategories pour le filtrage par permission (commande par
 * commande, propre à l'auteur).
 * @param {import('discord.js').Message} message
 * @param {string} prefix
 * @param {{ moderationCommands?: string[] }} [options]
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
