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
const { getCategories, ASSIGNABLE_COMMANDS } = require("./permissionCategoryStore");
const { canUseCommand } = require("./permissions");

const HELP_TIMEOUT_MS = 5 * 60_000;

// Description affichée par commande assignable dans `.help` — voir
// utils/permissionCategoryStore.js pour la liste canonique des commandes.
function assignableCommandLine(prefix, cmd) {
  const lines = {
    helpall: `\`${prefix}helpall\` — Liste les commandes par catégorie de permission`,
    perms: `\`${prefix}perms\` — Liste les rôles par catégorie de permission`,
    panel: `\`${prefix}panel\` — Config du bot (préfixes, logs, permissions, rôles)`,
    renew: `\`${prefix}renew\` — Recrée le salon (vide)`,
    hide: `\`${prefix}hide\` — Cache le salon à @everyone`,
    unhide: `\`${prefix}unhide\` — Affiche le salon à @everyone`,
    lock: `\`${prefix}lock\` — Bloque l'écriture pour @everyone`,
    unlock: `\`${prefix}unlock\` — Débloque l'écriture pour @everyone`,
    massrole: `\`${prefix}massrole add|remove @role\` — Rôle en masse (utilise l'ID pour ne pas ping)`,
    addrole: `\`${prefix}addrole [@membre @role]\` — Ajoute un rôle à un membre (menus déroulants si aucun argument)`,
    delrole: `\`${prefix}delrole [@membre @role]\` — Retire un rôle à un membre (menus déroulants si aucun argument)`,
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

/**
 * Catégories du panel d'aide "-help", construites commande par commande via
 * canUseCommand plutôt qu'avec des groupes fixes "mod"/"ban" — chaque
 * commande assignable (voir ASSIGNABLE_COMMANDS) n'apparaît que si l'auteur
 * y a réellement accès (admin, permission Discord native pour ban/unban/
 * unbanall, ou rôle autorisé pour une catégorie de `.panel` > Permissions
 * qui l'inclut). Deux personnes avec des catégories différentes voient donc
 * des listes différentes. "⚠️ Danger" (`.banall`) n'apparaît que pour un
 * vrai administrateur, jamais via une catégorie de permission (exclue de
 * ASSIGNABLE_COMMANDS).
 * @param {string} prefix
 * @param {import('discord.js').Message} message
 */
function buildDashCategories(prefix, message) {
  const categories = [
    {
      key: "public",
      label: "Commandes publiques",
      names: ["pic", "avatar", "snipe", "clear me", "gif"],
      lines: [
        `\`${prefix}pic\`/\`${prefix}avatar [@membre]\` — Photo de profil (toi par défaut)`,
        `\`${prefix}snipe\` — Dernier message supprimé du salon`,
        `\`${prefix}clear me\` (ou \`uo clear\`) — Supprime tes messages récents (5×/25 min)`,
        `\`${prefix}gif <recherche>\` — Envoie un gif`,
      ],
    },
  ];

  const allowed = ASSIGNABLE_COMMANDS.filter((cmd) => canUseCommand(message, cmd));
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
 * filtrage par permission (commande par commande, propre à l'auteur).
 * @param {import('discord.js').Message} message
 * @param {string} prefix
 */
async function sendDashHelpPanel(message, prefix) {
  const categories = buildDashCategories(prefix, message);
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

/**
 * `.helpall` : liste chaque catégorie de permission (voir `.panel` >
 * Permissions, utils/permissionCategoryStore.js) avec les commandes qui lui
 * sont associées — un aperçu de "qui peut faire quoi", sans les rôles
 * (voir `.perms` pour ça).
 * @param {import('discord.js').Message} message
 */
async function sendHelpAllPanel(message) {
  const categories = getCategories(message.guildId);
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Permissions liées aux commandes\n> Voici les différentes permissions ainsi que les commandes accessibles."
    )
  );

  if (categories.length === 0) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("*Aucune catégorie configurée — voir `.panel` > Permissions.*")
    );
  }

  for (const cat of categories) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Permission ${cat.id}**\n↳ ${cat.commands.length ? cat.commands.join(", ") : "*aucune commande*"}`
      )
    );
  }

  await message.reply({ flags: MessageFlags.IsComponentsV2, components: [container] });
}

/**
 * `.perms` : liste chaque catégorie de permission avec les rôles qui y sont
 * autorisés — le pendant "rôles" de `.helpall` (qui liste les commandes).
 * @param {import('discord.js').Message} message
 */
async function sendPermsPanel(message) {
  const categories = getCategories(message.guildId);
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Permissions\n> Voici les différentes permissions ainsi que les rôles associés."
    )
  );

  if (categories.length === 0) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent("*Aucune catégorie configurée — voir `.panel` > Permissions.*")
    );
  }

  for (const cat of categories) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `**Permission ${cat.id}**\n↳ ${cat.roles.length ? cat.roles.map((id) => `<@&${id}>`).join(", ") : "*aucun rôle*"}`
      )
    );
  }

  await message.reply({ flags: MessageFlags.IsComponentsV2, components: [container] });
}

module.exports = { buildMusicHelpPanel, sendDashHelpPanel, sendHelpAllPanel, sendPermsPanel, buildHelpPanel };
