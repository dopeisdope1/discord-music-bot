const { PermissionFlagsBits, EmbedBuilder } = require("discord.js");
const { LOOP_LABELS } = require("./nowPlayingPanel");
const { buildMusicHelpPanel, buildDashHelpPanel } = require("./helpPanels");
const { hasModPermission, hasBanPermission } = require("./permissions");
const { buildStatusEmbed } = require("./statusEmbed");
const { handleSpotifyPlay } = require("./spotifyPlay");
const { queueAndPlay, stopNowPlayingTracking, setPlayerPaused } = require("./musicPlayer");
const { handleJoinSpotify } = require("./joinSpotify");
const { handleBanPanel, handleUnbanPanel, unbanById } = require("./banPanel");
const { handlePrefixPanel } = require("./prefixPanel");
const { getPrefixes } = require("./prefixStore");
const { sendLog } = require("./actionLogger");
const { validateMassRoleTarget, runMassRole } = require("./massRole");
const { createRateLimiter } = require("./rateLimiter");
const { randomClearJoke } = require("./jokes");
const { playbackErrorMessage } = require("./musicErrors");
const { searchGif } = require("./gifSearch");
const { canControlPlayer, requestPlayerAccess, clearPlayerControl } = require("./playerControl");

const URL_REGEX = /^https?:\/\//i;
const LOOP_KEYWORDS = {
  off: "none",
  désactivé: "none",
  "0": "none",
  song: "track",
  chanson: "track",
  "1": "track",
  queue: "queue",
  file: "queue",
  "2": "queue",
};

// Commandes "." accessibles à tout le monde, sans permission particulière
const DASH_MEMBER_COMMANDS = new Set(["pic", "avatar", "snipe", "gif"]);
// Commandes "." réservées aux administrateurs
const DASH_ADMIN_COMMANDS = new Set(["renew", "hide", "unhide", "lock", "unlock", "massrole", "panel", "create"]);
const DASH_COMMANDS = new Set([...DASH_MEMBER_COMMANDS, ...DASH_ADMIN_COMMANDS]);
// Commandes "." réservées à l'admin ou à la permission "Bannir des membres"
const BAN_COMMANDS = new Set(["ban", "unban"]);

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
// "-clear me" / "uo clear" : ouvert à tout le monde, mais limité en fréquence
const clearMeLimiter = createRateLimiter(5, 25 * 60 * 1000);

function getPlayerOrReply(client, message) {
  const player = client.kazagumo.players.get(message.guildId);
  if (!player) {
    message.reply({ embeds: [buildStatusEmbed("error", "Aucune musique en cours.")] });
    return null;
  }
  return player;
}

/**
 * Vérifie que l'auteur du message peut utiliser une commande de contrôle
 * (pause/skip/stop/volume/loop/leave) : seule la personne qui a amené le bot
 * en vocal (ou quelqu'un qu'elle a autorisé) le peut — voir utils/playerControl.js.
 * Si ce n'est pas le cas, envoie une demande d'autorisation au propriétaire.
 * @returns {Promise<boolean>} true si la commande peut continuer
 */
async function requirePlayerControl(client, message) {
  if (canControlPlayer(client, message.guildId, message.author.id)) return true;
  requestPlayerAccess(client, message.channel, message.author, message.guildId);
  await message.reply({
    embeds: [
      buildStatusEmbed(
        "info",
        "Cette commande est réservée à la personne qui a lancé la musique. Une demande d'autorisation lui a été envoyée."
      ),
    ],
  });
  return false;
}

function requireModPermission(message) {
  if (!hasModPermission(message)) {
    message.reply({
      embeds: [buildStatusEmbed("error", "Tu dois être administrateur du serveur pour utiliser cette commande.")],
    });
    return false;
  }
  return true;
}

async function sendTempReply(channel, content, ms = 5000) {
  try {
    const payload = typeof content === "string" ? { content } : content;
    const msg = await channel.send(payload);
    setTimeout(() => msg.delete().catch(() => {}), ms);
  } catch {
    /* ignore */
  }
}

/**
 * Supprime des messages du salon par lots de 100 (limite Discord), jusqu'à
 * `maxCount` (ou tout le salon si non précisé) et jusqu'à 14 jours d'ancienneté
 * (limite du bulk delete). Si `targetMemberId` est fourni, ne supprime que ses
 * messages ; sinon, supprime tout ce qui passe (le plus récent en premier).
 */
async function clearMessages(client, channel, { targetMemberId, maxCount = Infinity } = {}) {
  let deletedTotal = 0;
  let beforeId;

  for (let i = 0; i < 10 && deletedTotal < maxCount; i++) {
    const fetchLimit = Math.min(100, maxCount - deletedTotal);
    const fetched = await channel.messages.fetch({ limit: fetchLimit, before: beforeId });
    if (fetched.size === 0) break;

    const eligible = fetched.filter((m) => Date.now() - m.createdTimestamp < FOURTEEN_DAYS_MS);
    const toDelete = targetMemberId ? eligible.filter((m) => m.author.id === targetMemberId) : eligible;

    if (toDelete.size > 0) {
      const deleted = await channel.bulkDelete(toDelete, true).catch(() => null);
      if (deleted) {
        deletedTotal += deleted.size;
        const last = [...deleted.values()][0];
        if (last) rememberSnipe(client, channel.id, last, "cleared");
      }
    }

    // Sans filtre par membre, les messages supprimés libèrent naturellement
    // la place : on peut re-fetcher "les plus récents" sans curseur. Avec un
    // filtre, il faut avancer le curseur pour dépasser les messages ignorés.
    beforeId = targetMemberId ? fetched.last().id : undefined;
    if (fetched.size < fetchLimit) break;
  }

  return deletedTotal;
}

const handlers = {
  // ---- Musique ----
  async play(client, message, args) {
    const query = args.join(" ");
    if (!query)
      return message.reply({
        embeds: [buildStatusEmbed("error", "Indique un nom de musique/artiste, ou un lien YouTube/Spotify.")],
      });
    const vc = message.member.voice.channel;
    if (!vc)
      return message.reply({ embeds: [buildStatusEmbed("error", "Tu dois être dans un salon vocal.")] });

    if (URL_REGEX.test(query)) {
      try {
        const outcome = await queueAndPlay(client.kazagumo, {
          voiceChannel: vc,
          textChannel: message.channel,
          member: message.member,
          query,
          client,
        });
        if (!outcome) {
          return message.reply({ embeds: [buildStatusEmbed("error", "Impossible de jouer ce titre. Vérifie le lien.")] });
        }
        const label = outcome.alreadyPlaying ? "Ajouté à la file d'attente" : "Lancement de";
        await message.reply({
          embeds: [buildStatusEmbed("info", `${label} : **${outcome.result.tracks[0].title}**`)],
        });
      } catch (err) {
        console.error(err);
        await message.reply({
          embeds: [buildStatusEmbed("error", playbackErrorMessage(err, "Impossible de jouer ce titre. Vérifie le lien."))],
        });
      }
      return;
    }

    await handleSpotifyPlay({
      kazagumo: client.kazagumo,
      client,
      voiceChannel: vc,
      textChannel: message.channel,
      member: message.member,
      query,
      requesterId: message.author.id,
      send: (payload) => message.reply(payload),
    });
  },

  async join(client, message) {
    const vc = message.member.voice.channel;
    if (!vc)
      return message.reply({ embeds: [buildStatusEmbed("error", "Tu dois être dans un salon vocal.")] });

    const listenerMember = message.mentions.members?.first() || message.member;

    await handleJoinSpotify({
      client,
      voiceChannel: vc,
      textChannel: message.channel,
      listenerMember,
      playerMember: message.member,
      send: (payload) => message.reply(payload),
    });
  },

  async skip(client, message) {
    const player = getPlayerOrReply(client, message);
    if (!player) return;
    if (!(await requirePlayerControl(client, message))) return;
    if (!player.queue.current) {
      return message.reply({ embeds: [buildStatusEmbed("error", "Rien à passer.")] });
    }
    player.skip();
    await message.reply({ embeds: [buildStatusEmbed("success", "Musique passée.")] });
  },

  async stop(client, message) {
    const player = getPlayerOrReply(client, message);
    if (!player) return;
    if (!(await requirePlayerControl(client, message))) return;
    stopNowPlayingTracking(client, message.guildId);
    clearPlayerControl(client, message.guildId);
    player.destroy();
    await message.reply({
      embeds: [buildStatusEmbed("success", "Musique arrêtée et file d'attente vidée.")],
    });
  },

  async leave(client, message) {
    const player = getPlayerOrReply(client, message);
    if (!player) return;
    if (!(await requirePlayerControl(client, message))) return;
    stopNowPlayingTracking(client, message.guildId);
    clearPlayerControl(client, message.guildId);
    player.destroy();
    await message.reply({ embeds: [buildStatusEmbed("success", "J'ai quitté le salon vocal.")] });
  },

  async pause(client, message) {
    const player = getPlayerOrReply(client, message);
    if (!player) return;
    if (!(await requirePlayerControl(client, message))) return;
    setPlayerPaused(player, true);
    await message.reply({ embeds: [buildStatusEmbed("success", "Musique en pause.")] });
  },

  async resume(client, message) {
    const player = getPlayerOrReply(client, message);
    if (!player) return;
    if (!(await requirePlayerControl(client, message))) return;
    setPlayerPaused(player, false);
    await message.reply({ embeds: [buildStatusEmbed("success", "Musique reprise.")] });
  },

  async queue(client, message) {
    const player = getPlayerOrReply(client, message);
    if (!player) return;
    const tracks = [player.queue.current, ...player.queue].filter(Boolean);
    if (tracks.length === 0)
      return message.reply({ embeds: [buildStatusEmbed("error", "La file d'attente est vide.")] });
    const list = tracks
      .slice(0, 15)
      .map((t, i) => `${i === 0 ? "En cours :" : `${i}.`} **${t.title}**`)
      .join("\n");
    await message.reply({
      embeds: [
        buildStatusEmbed("info", list, { title: `File d'attente (${tracks.length} titres)` }),
      ],
    });
  },

  async volume(client, message, args) {
    const player = getPlayerOrReply(client, message);
    if (!player) return;
    if (!(await requirePlayerControl(client, message))) return;
    const niveau = parseInt(args[0], 10);
    if (isNaN(niveau) || niveau < 0 || niveau > 150) {
      const { main } = getPrefixes(message.guild.id);
      return message.reply({
        embeds: [buildStatusEmbed("error", `Indique un volume entre 0 et 150. Ex : \`${main}volume 80\``)],
      });
    }
    player.setVolume(niveau);
    await message.reply({
      embeds: [buildStatusEmbed("success", `Volume réglé sur **${niveau}%**.`)],
    });
  },

  async loop(client, message, args) {
    const player = getPlayerOrReply(client, message);
    if (!player) return;
    if (!(await requirePlayerControl(client, message))) return;
    const mode = LOOP_KEYWORDS[(args[0] || "").toLowerCase()];
    if (!mode) {
      const { main } = getPrefixes(message.guild.id);
      return message.reply({
        embeds: [buildStatusEmbed("error", `Mode invalide. Utilise : \`${main}loop off|song|queue\``)],
      });
    }
    player.setLoop(mode);
    await message.reply({
      embeds: [buildStatusEmbed("success", `Mode de répétition : **${LOOP_LABELS[mode]}**`)],
    });
  },

  // ---- Aide ----
  async help(client, message) {
    await message.channel.send(buildMusicHelpPanel());
  },

  // ---- Modération (préfixe ".") ----
  async clear(client, message, args) {
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageMessages)) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Il me manque la permission **Gérer les messages**.")],
      });
    }

    const channel = message.channel;
    message.delete().catch(() => {});

    const mentioned = message.mentions.members?.first();
    const rawArg = args[0] || "";
    const arg = rawArg.toLowerCase();

    let targetMemberId;
    let maxCount = Infinity;
    let isSelfClear = false;

    if (mentioned) {
      targetMemberId = mentioned.id;
    } else if (arg === "me") {
      targetMemberId = message.author.id;
      isSelfClear = true;
    } else if (/^\d{15,}$/.test(rawArg)) {
      // ID brut d'un membre (pas de mention)
      targetMemberId = rawArg;
    }

    if (isSelfClear) {
      // Ouvert à tout le monde, mais limité à 5 utilisations / 25 min
      const { allowed, retryAfterMs } = clearMeLimiter.check(message.author.id);
      if (!allowed) {
        const minutes = Math.ceil(retryAfterMs / 60000);
        return sendTempReply(
          channel,
          {
            embeds: [
              buildStatusEmbed(
                "error",
                `Tu as atteint la limite (5 utilisations / 25 min). Réessaie dans ${minutes} min.`
              ),
            ],
          },
          15000
        );
      }
    } else if (targetMemberId) {
      // Cible quelqu'un d'autre (@membre ou ID) : réservé aux administrateurs
      if (!hasModPermission(message)) {
        return sendTempReply(
          channel,
          {
            embeds: [
              buildStatusEmbed(
                "error",
                "Tu dois être administrateur pour supprimer les messages d'un autre membre."
              ),
            ],
          },
          15000
        );
      }
    } else {
      // -clear <nombre> : réservé aux administrateurs
      if (!hasModPermission(message)) {
        return sendTempReply(
          channel,
          { embeds: [buildStatusEmbed("error", "Tu n'as pas la permission d'utiliser cette commande.")] },
          15000
        );
      }
      const amount = parseInt(rawArg, 10);
      if (isNaN(amount) || amount <= 0 || !Number.isInteger(amount)) {
        const { dash } = getPrefixes(message.guild.id);
        return sendTempReply(
          channel,
          {
            embeds: [
              buildStatusEmbed(
                "error",
                `Utilisation : \`${dash}clear me\` (tes messages), \`${dash}clear @membre\`/\`<id>\` ou \`${dash}clear <nombre>\``
              ),
            ],
          },
          15000
        );
      }
      maxCount = amount;
    }

    // Envoie la confirmation tout de suite, sans attendre la fin de la
    // suppression (qui peut prendre plusieurs secondes à cause du
    // rate-limit Discord sur bulkDelete) ; le nombre exact est ajouté par
    // une édition une fois le nettoyage terminé.
    const joke = randomClearJoke();
    const tempMessage = await channel.send({ embeds: [buildStatusEmbed("success", joke)] }).catch(() => null);
    if (tempMessage) setTimeout(() => tempMessage.delete().catch(() => {}), 15000);

    clearMessages(client, channel, { targetMemberId, maxCount })
      .then((deletedTotal) => {
        tempMessage
          ?.edit({ embeds: [buildStatusEmbed("success", `**${deletedTotal}** supprimé(s) — ${joke}`)] })
          .catch(() => {});
        sendLog(client, message.guild.id, "moderation", {
          title: "Clear",
          description: `**${deletedTotal}** message(s) supprimé(s) dans ${channel}.`,
          actor: message.author,
          fields: targetMemberId ? [{ name: "Cible", value: `<@${targetMemberId}>`, inline: true }] : undefined,
        });
      })
      .catch((err) => console.error(err));
  },

  async panel(client, message) {
    await handlePrefixPanel(message);
  },

  async ban(client, message) {
    await handleBanPanel(message);
  },

  async unban(client, message, args) {
    const rawArg = args[0];
    if (rawArg && /^\d{15,}$/.test(rawArg)) {
      return unbanById(message, rawArg);
    }
    await handleUnbanPanel(message);
  },

  async renew(client, message) {
    const channel = message.channel;
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Il me manque la permission **Gérer les salons**.")],
      });
    }
    try {
      const clone = await channel.clone({ reason: `Salon renouvelé par ${message.author.tag}` });
      await clone.setPosition(channel.position).catch(() => {});
      await channel.delete().catch(() => {});
      await sendTempReply(clone, { embeds: [buildStatusEmbed("success", "Salon renouvelé.")] }, 15000);
      sendLog(client, message.guild.id, "salon", {
        title: "Renew",
        description: `Salon **#${channel.name}** renouvelé.`,
        actor: message.author,
      });
    } catch (err) {
      console.error(err);
      await message.channel.send({
        embeds: [buildStatusEmbed("error", "Impossible de renouveler le salon.")],
      });
    }
  },

  async hide(client, message) {
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Il me manque la permission **Gérer les rôles**.")],
      });
    }
    await message.channel.permissionOverwrites
      .edit(message.guild.roles.everyone, { ViewChannel: false })
      .catch(() => {});
    await sendTempReply(
      message.channel,
      { embeds: [buildStatusEmbed("info", "Salon caché pour @everyone.")], allowedMentions: { parse: [] } },
      15000
    );
    sendLog(client, message.guild.id, "salon", {
      title: "Hide",
      description: "Salon caché pour @everyone.",
      actor: message.author,
      fields: [{ name: "Salon", value: `${message.channel}`, inline: true }],
    });
  },

  async unhide(client, message) {
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Il me manque la permission **Gérer les rôles**.")],
      });
    }
    await message.channel.permissionOverwrites
      .edit(message.guild.roles.everyone, { ViewChannel: null })
      .catch(() => {});
    await sendTempReply(
      message.channel,
      {
        embeds: [buildStatusEmbed("success", "Salon de nouveau visible pour @everyone.")],
        allowedMentions: { parse: [] },
      },
      15000
    );
    sendLog(client, message.guild.id, "salon", {
      title: "Unhide",
      description: "Salon rendu visible pour @everyone.",
      actor: message.author,
      fields: [{ name: "Salon", value: `${message.channel}`, inline: true }],
    });
  },

  async lock(client, message) {
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Il me manque la permission **Gérer les rôles**.")],
      });
    }
    await message.channel.permissionOverwrites
      .edit(message.guild.roles.everyone, { SendMessages: false })
      .catch(() => {});
    await message.channel.send({
      embeds: [
        buildStatusEmbed("warning", "Salon verrouillé : @everyone ne peut plus écrire ici."),
      ],
      allowedMentions: { parse: [] },
    });
    sendLog(client, message.guild.id, "salon", {
      title: "Lock",
      description: "Salon verrouillé : @everyone ne peut plus écrire ici.",
      actor: message.author,
      fields: [{ name: "Salon", value: `${message.channel}`, inline: true }],
    });
  },

  async unlock(client, message) {
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Il me manque la permission **Gérer les rôles**.")],
      });
    }
    await message.channel.permissionOverwrites
      .edit(message.guild.roles.everyone, { SendMessages: null })
      .catch(() => {});
    await message.channel.send({
      embeds: [
        buildStatusEmbed("success", "Salon déverrouillé : @everyone peut de nouveau écrire."),
      ],
      allowedMentions: { parse: [] },
    });
    sendLog(client, message.guild.id, "salon", {
      title: "Unlock",
      description: "Salon déverrouillé : @everyone peut de nouveau écrire.",
      actor: message.author,
      fields: [{ name: "Salon", value: `${message.channel}`, inline: true }],
    });
  },

  async massrole(client, message, args) {
    const action = (args[0] || "").toLowerCase();
    const roleArg = (args[1] || "").replace(/[<>]/g, "");
    const role =
      message.mentions.roles?.first() ||
      (roleArg && /^\d{15,}$/.test(roleArg)
        ? await message.guild.roles.fetch(roleArg).catch(() => null)
        : null);

    if (!["add", "remove"].includes(action) || !role) {
      const { dash } = getPrefixes(message.guild.id);
      return message.reply({
        embeds: [
          buildStatusEmbed(
            "error",
            `Utilisation : \`${dash}massrole add @role\`/\`<id>\` ou \`${dash}massrole remove @role\`/\`<id>\` (utilise l'ID pour ne pas ping tout le rôle). Aussi disponible dans \`${dash}panel\`.`
          ),
        ],
      });
    }

    const invalidReason = validateMassRoleTarget(message.guild, role);
    if (invalidReason) {
      return message.reply({ embeds: [buildStatusEmbed("error", invalidReason)] });
    }

    await message.reply({
      embeds: [
        buildStatusEmbed(
          "info",
          `${action === "add" ? "Ajout" : "Retrait"} du rôle **${role.name}** en cours pour tous les membres...`
        ),
      ],
    });

    const { success, failed } = await runMassRole({
      client,
      guild: message.guild,
      actor: message.author,
      action,
      role,
    });

    await message.channel.send({
      embeds: [
        buildStatusEmbed(
          "success",
          `${action === "add" ? "Ajouté" : "Retiré"} **${role.name}** pour **${success}** membre(s)` +
            (failed ? ` (${failed} échec(s))` : "") +
            "."
        ),
      ],
    });
  },

  async pic(client, message) {
    const target = message.mentions.members?.first() || message.member;
    const avatarUrl = target.displayAvatarURL({ size: 1024 });
    await message.reply({
      embeds: [new EmbedBuilder().setTitle(`Photo de profil de ${target.displayName}`).setImage(avatarUrl)],
    });
  },

  async avatar(client, message, args) {
    return handlers.pic(client, message, args);
  },

  async snipe(client, message) {
    const data = client.snipes.get(message.channel.id);
    if (!data) {
      return message.reply({ embeds: [buildStatusEmbed("error", "Rien à sniper dans ce salon.")] });
    }
    const label = data.type === "cleared" ? "supprimé via une commande clear" : "supprimé";
    await message.channel.send({
      embeds: [
        buildStatusEmbed(
          "info",
          `Par **${data.authorTag}**, <t:${Math.floor(data.timestamp / 1000)}:R> — ${label}\n> ${
            data.content || "*[contenu vide ou non textuel]*"
          }`,
          { title: "Message sniped" }
        ),
      ],
      allowedMentions: { parse: [] },
    });
  },

  async gif(client, message, args) {
    const query = args.join(" ");
    if (!query) {
      const { dash } = getPrefixes(message.guild.id);
      return message.reply({ embeds: [buildStatusEmbed("error", `Indique une recherche. Ex : \`${dash}gif chat\``)] });
    }
    try {
      const url = await searchGif(query);
      if (!url) {
        return message.reply({ embeds: [buildStatusEmbed("error", `Aucun gif trouvé pour "${query}".`)] });
      }
      await message.reply(url);
    } catch (err) {
      console.error(err);
      await message.reply({ embeds: [buildStatusEmbed("error", "Impossible de récupérer un gif pour le moment.")] });
    }
  },

  async create(client, message, args) {
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Il me manque la permission **Gérer les expressions du serveur**.")],
      });
    }

    const name = args[0];
    const attachment = message.attachments.first();
    const source = attachment?.url || args[1];

    if (!name || !/^[a-zA-Z0-9_]{2,32}$/.test(name) || !source) {
      const { dash } = getPrefixes(message.guild.id);
      return message.reply({
        embeds: [
          buildStatusEmbed(
            "error",
            `Utilisation : \`${dash}create <nom> <url>\` ou \`${dash}create <nom>\` avec une image en pièce jointe. Le nom doit faire 2 à 32 caractères (lettres, chiffres, _).`
          ),
        ],
      });
    }

    try {
      const emoji = await message.guild.emojis.create({
        attachment: source,
        name,
        reason: `Créé par ${message.author.tag}`,
      });
      await message.reply({ embeds: [buildStatusEmbed("success", `Emoji ${emoji} créé : \`:${emoji.name}:\``)] });
    } catch (err) {
      console.error(err);
      await message.reply({
        embeds: [
          buildStatusEmbed(
            "error",
            "Impossible de créer l'emoji (format/taille d'image invalide, limite d'emojis du serveur atteinte, ou permission insuffisante)."
          ),
        ],
      });
    }
  },
};

/**
 * Enregistre un message pour la commande -snipe.
 */
function rememberSnipe(client, channelId, message, type) {
  if (!message?.author || message.author.bot) return;
  client.snipes.set(channelId, {
    content: message.content,
    authorTag: message.author.tag,
    timestamp: Date.now(),
    type,
  });
}

/**
 * À appeler dans l'écouteur "messageCreate" du client.
 */
async function handleTextCommand(client, message) {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const { main: MAIN_PREFIX, dash: DASH_PREFIX } = getPrefixes(message.guild.id);

  // Déclencheur spécial sans préfixe : "uo clear" = ".clear me" (supprime tes
  // propres messages), ouvert à tout le monde (limite gérée dans le handler)
  if (content.toLowerCase() === "uo clear") {
    return handlers.clear(client, message, ["me"]);
  }

  // Préfixe "." (configurable via .panel) : commandes membres + modération + ban/unban
  if (content.startsWith(DASH_PREFIX) && !content.startsWith(MAIN_PREFIX)) {
    const [cmdRaw, ...args] = content.slice(DASH_PREFIX.length).trim().split(/\s+/);
    const cmd = (cmdRaw || "").toLowerCase();
    if (cmd === "help") {
      return message.channel.send(
        buildDashHelpPanel(DASH_PREFIX, {
          hasMod: hasModPermission(message),
          hasBan: hasBanPermission(message),
        })
      );
    }
    if (cmd === "clear") {
      // Permission gérée dans le handler : dépend de la cible (soi-même,
      // quelqu'un d'autre, ou un nombre).
      return handlers.clear(client, message, args);
    }
    if (BAN_COMMANDS.has(cmd)) {
      if (!hasBanPermission(message)) {
        return message.reply({
          embeds: [
            buildStatusEmbed(
              "error",
              "Tu dois être administrateur ou avoir la permission **Bannir des membres** pour utiliser cette commande."
            ),
          ],
        });
      }
      return handlers[cmd](client, message, args);
    }
    if (!DASH_COMMANDS.has(cmd)) return;
    if (DASH_ADMIN_COMMANDS.has(cmd) && !requireModPermission(message)) return;
    return handlers[cmd](client, message, args);
  }

  // Préfixe principal (! par défaut, configurable via .panel)
  if (content.startsWith(MAIN_PREFIX)) {
    const [cmdRaw, ...args] = content.slice(MAIN_PREFIX.length).trim().split(/\s+/);
    const cmd = (cmdRaw || "").toLowerCase();
    if (cmd === "help") {
      return message.channel.send(buildMusicHelpPanel(MAIN_PREFIX));
    }
    if (handlers[cmd]) {
      return handlers[cmd](client, message, args);
    }
  }
}

module.exports = { handleTextCommand, rememberSnipe };