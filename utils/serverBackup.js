const { ChannelType } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const backupStore = require("./serverBackupStore");
const voiceChannels = require("./voiceChannels");
const { requestConfirmation } = require("./serverAdminCommands");

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });

// Préréglages intégrés au code (pas dans le store JSON) : servent à
// restaurer un serveur que le BOT n'a plus les moyens de visiter lui-même
// (banni, salon supprimé...) — la personne fournit la structure de mémoire
// une fois, et &backup load la restaure comme n'importe quelle sauvegarde
// normale. "yunara" : saisi à la main depuis des captures d'écran fournies
// par l'utilisateur après un bannissement du bot ET de son compte du
// serveur d'origine — aucun moyen de le récupérer autrement.
const PRESET_BACKUPS = {
  yunara: {
    sourceGuildName: "yunara (saisi à la main depuis des captures d'écran, bot banni du serveur d'origine)",
    createdAt: null,
    categories: [
      {
        name: "Informations",
        channels: [
          { name: "📢・annonce", type: ChannelType.GuildText },
          { name: "🧧・gw", type: ChannelType.GuildText },
          { name: "📜・sondage", type: ChannelType.GuildText },
          { name: "📥・invites", type: ChannelType.GuildText },
          { name: "🏆・stats", type: ChannelType.GuildText },
        ],
      },
      {
        name: "Salons textuels",
        channels: [
          { name: "💬・chat", type: ChannelType.GuildText },
          { name: "📸・médias", type: ChannelType.GuildText },
          { name: "📱・selfies", type: ChannelType.GuildText },
          { name: "🛠️・cmds", type: ChannelType.GuildText },
          { name: "🌺・mudae", type: ChannelType.GuildText },
        ],
      },
      {
        name: "Salons vocaux",
        channels: [
          "ptit s1 gros coeur",
          "10 12 14 bureau",
          "84 c'est city",
          "Itadakimase",
          "wee tehna",
          "Santé Bondy",
          "six sevennn",
          "c nwarr",
          "kc on top",
          "en détente",
          "beleck sa tire",
          "212 & 213",
          "concentrarrr",
          "135 CITY",
        ].map((name) => ({ name, type: ChannelType.GuildVoice })),
      },
      {
        name: "Salons vocaux temporaires",
        channels: [{ name: "➕ Nouveau salon vocal", type: ChannelType.GuildVoice, isVoiceHub: true }],
      },
      {
        // La liste des "prv" continuait au-delà de prv 6 sur les captures
        // fournies mais a été coupée — seules prv 1 à 6 sont restaurées ici,
        // le reste est à recréer à la main après &backup load si besoin.
        name: "Salons privées",
        channels: [
          { name: "prv 1", type: ChannelType.GuildVoice, userLimit: 2 },
          { name: "prv 2", type: ChannelType.GuildVoice, userLimit: 2 },
          { name: "prv 3", type: ChannelType.GuildVoice, userLimit: 2 },
          { name: "prv 4", type: ChannelType.GuildVoice, userLimit: 3 },
          { name: "prv 5", type: ChannelType.GuildVoice, userLimit: 3 },
          { name: "prv 6", type: ChannelType.GuildVoice, userLimit: 4 },
        ],
      },
    ],
    uncategorized: [{ name: "rules", type: ChannelType.GuildText }],
  },
};

const CREATABLE_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory, ChannelType.GuildAnnouncement]);

/** Capture la structure ACTUELLE d'un serveur (catégories, salons, ordre, limite de places vocales) — pas les permissions ni les messages, voir doc &backup. */
function captureGuildStructure(guild) {
  const channels = [...guild.channels.cache.values()]
    .filter((c) => CREATABLE_TYPES.has(c.type))
    .sort((a, b) => a.rawPosition - b.rawPosition);

  const hubId = voiceChannels.getHub(guild.id);
  const categoriesById = new Map();
  const categories = [];
  for (const c of channels) {
    if (c.type !== ChannelType.GuildCategory) continue;
    const entry = { name: c.name, channels: [] };
    categoriesById.set(c.id, entry);
    categories.push(entry);
  }

  const uncategorized = [];
  for (const c of channels) {
    if (c.type === ChannelType.GuildCategory) continue;
    const entry = { name: c.name, type: c.type };
    if (c.type === ChannelType.GuildVoice && c.userLimit) entry.userLimit = c.userLimit;
    if (c.id === hubId) entry.isVoiceHub = true;
    const target = c.parentId && categoriesById.get(c.parentId);
    if (target) target.channels.push(entry);
    else uncategorized.push(entry);
  }

  return {
    sourceGuildId: guild.id,
    sourceGuildName: guild.name,
    createdAt: new Date().toISOString(),
    categories,
    uncategorized,
  };
}

/**
 * Recrée catégories/salons dans `guild` d'après une structure sauvegardée.
 * Séquentiel (pas de Promise.all) : les salons d'une catégorie dépendent de
 * l'ID de la catégorie qui vient d'être créée, et Discord limite de toute
 * façon le débit de création de salons.
 */
async function applyStructure(guild, structure) {
  let categoriesCreated = 0;
  let channelsCreated = 0;
  let hubChannelId = null;
  let hubCategoryId = null;

  for (const cat of structure.categories) {
    const category = await guild.channels.create({ name: cat.name, type: ChannelType.GuildCategory });
    categoriesCreated++;
    for (const ch of cat.channels) {
      const created = await guild.channels.create({
        name: ch.name,
        type: ch.type,
        parent: category.id,
        ...(ch.type === ChannelType.GuildVoice && ch.userLimit ? { userLimit: ch.userLimit } : {}),
      });
      channelsCreated++;
      if (ch.isVoiceHub) {
        hubChannelId = created.id;
        hubCategoryId = category.id;
      }
    }
  }
  for (const ch of structure.uncategorized || []) {
    await guild.channels.create({ name: ch.name, type: ch.type });
    channelsCreated++;
  }

  if (hubChannelId) {
    voiceChannels.setHub(guild.id, hubChannelId);
    voiceChannels.setSpawnCategory(guild.id, hubCategoryId);
  }

  return { categoriesCreated, channelsCreated, wiredVoiceHub: Boolean(hubChannelId) };
}

function countChannels(structure) {
  return (structure.uncategorized?.length || 0) + structure.categories.reduce((n, c) => n + c.channels.length, 0);
}

function resolveBackup(name) {
  return backupStore.getBackup(name) || PRESET_BACKUPS[name.toLowerCase()] || null;
}

/**
 * @param {{ doubleConfirm?: boolean }} [options] `doubleConfirm` ajoute une
 * seconde confirmation avant `load` (restauration) — demandé explicitement
 * pour l'accès depuis &panel, où un mauvais clic est plus facile qu'en tapant
 * la commande. `&backup load` au clavier garde sa confirmation unique
 * inchangée (options omis).
 */
async function backup(client, message, args, options = {}) {
  if (!can(message.member, "sys")) return;
  const sub = (args[0] || "").toLowerCase();

  if (!sub) {
    const presets = Object.keys(PRESET_BACKUPS);
    return message.reply({
      embeds: [
        buildStatusEmbed(
          "info",
          [
            "`backup <nom>` — sauvegarde la structure ACTUELLE de ce serveur (catégories, salons, ordre, limites de places vocales)",
            "`backup list` — liste les sauvegardes disponibles",
            "`backup delete <nom>` — supprime une sauvegarde",
            "`backup load <nom>` — restaure une sauvegarde dans CE serveur (confirmation obligatoire)",
            "",
            "Ne restaure PAS les permissions par salon, les messages, ni les emojis/webhooks.",
            presets.length ? `Préréglages intégrés (pas besoin d'avoir été sauvegardés) : ${presets.join(", ")}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          { title: "Sauvegarde de serveur" }
        ),
      ],
    });
  }

  if (sub === "list") {
    const saved = backupStore.listBackups();
    const presets = Object.keys(PRESET_BACKUPS).map((name) => ({ name, sourceGuildName: PRESET_BACKUPS[name].sourceGuildName, channelCount: countChannels(PRESET_BACKUPS[name]), preset: true }));
    const all = [...presets, ...saved];
    if (!all.length) return reply(message, "info", "Aucune sauvegarde enregistrée.");
    return message.reply({
      embeds: [
        buildStatusEmbed(
          "info",
          all.map((b) => `> **${b.name}**${b.preset ? " *(préréglage)*" : ""} — ${b.channelCount} salon(s) — ${b.sourceGuildName}`).join("\n"),
          { title: "Sauvegardes disponibles" }
        ),
      ],
    });
  }

  if (sub === "delete") {
    const name = args[1];
    if (!name) return reply(message, "error", "Indique un nom : `backup delete <nom>`.");
    if (PRESET_BACKUPS[name.toLowerCase()] && !backupStore.getBackup(name)) {
      return reply(message, "error", "C'est un préréglage intégré au code, il ne peut pas être supprimé par commande.");
    }
    const deleted = backupStore.deleteBackup(name);
    return reply(message, deleted ? "success" : "error", deleted ? `Sauvegarde **${name}** supprimée.` : `Aucune sauvegarde nommée **${name}**.`);
  }

  if (sub === "load") {
    const name = args[1];
    if (!name) return reply(message, "error", "Indique un nom : `backup load <nom>`.");
    const structure = resolveBackup(name);
    if (!structure) return reply(message, "error", `Aucune sauvegarde nommée **${name}** (voir \`backup list\`).`);
    const total = countChannels(structure);
    const restore = async (interaction) => {
      const { categoriesCreated, channelsCreated, wiredVoiceHub } = await applyStructure(interaction.guild, structure);
      await interaction.update({
        embeds: [
          buildStatusEmbed(
            "success",
            `**${categoriesCreated}** catégorie(s) et **${channelsCreated}** salon(s) créés.${wiredVoiceHub ? "\nLe générateur de salons vocaux temporaires a été rebranché automatiquement." : ""}`
          ),
        ],
        components: [],
      });
    };
    return requestConfirmation(message, {
      title: "Confirmer la restauration",
      body: `**${total}** salon(s) dans **${structure.categories.length}** catégorie(s) seront créés dans CE serveur, d'après la sauvegarde **${name}** (${structure.sourceGuildName}). Les permissions par salon, les messages et les emojis ne sont pas restaurés. Ça peut prendre une minute.`,
      confirmLabel: "Restaurer",
      permission: "sys",
      execute: options.doubleConfirm
        ? async (interaction) => {
            // `interaction` (le clic "Continuer") n'a pas encore été
            // accusé réception : .reply() ici sert de premier accusé ET
            // remplace le message par la seconde confirmation, plutôt que
            // .update() qui n'aurait fait qu'éditer la première carte sans
            // en garder de trace distincte.
            const secondMessage = { author: message.author, guild: interaction.guild, reply: (payload) => interaction.reply(payload) };
            return requestConfirmation(secondMessage, {
              title: "Dernière confirmation",
              body: `Aucun retour en arrière automatique : **${total}** salon(s) vont être créés maintenant dans **${interaction.guild.name}**, d'après **${name}**.`,
              confirmLabel: "Restaurer maintenant",
              permission: "sys",
              execute: restore,
            });
          }
        : restore,
    });
  }

  // Pas un mot-clé connu : c'est le NOM sous lequel sauvegarder l'état actuel.
  const name = args[0];
  if (PRESET_BACKUPS[name.toLowerCase()] && !backupStore.getBackup(name)) {
    return reply(
      message,
      "error",
      `**${name}** est un préréglage intégré au code — l'écraser masquerait la structure d'origine. Utilise \`backup load ${name}\` pour le restaurer, ou choisis un autre nom pour sauvegarder l'état actuel.`
    );
  }
  const structure = captureGuildStructure(message.guild);
  backupStore.saveBackup(name, structure);
  return reply(message, "success", `Sauvegarde **${name}** enregistrée (${countChannels(structure)} salon(s) dans ${structure.categories.length} catégorie(s)).`);
}

module.exports = { backup, captureGuildStructure, applyStructure, resolveBackup, countChannels, PRESET_BACKUPS };
