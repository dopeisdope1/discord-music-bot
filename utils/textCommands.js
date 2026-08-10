const { PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { LOOP_LABELS } = require("./nowPlayingPanel");
const { buildMusicHelpPanel, sendDashHelpPanel, sendHelpAllPanel, sendPermsPanel } = require("./helpPanels");
const { canUseCommand } = require("./permissions");
const { buildStatusEmbed } = require("./statusEmbed");
const { handleSpotifyPlay } = require("./spotifyPlay");
const { queueAndPlay, stopNowPlayingTracking, setPlayerPaused } = require("./musicPlayer");
const { handleJoinSpotify } = require("./joinSpotify");
const { handleBanPanel, handleUnbanPanel, unbanById } = require("./banPanel");
const {
  handleAddRolePanel,
  handleDelRolePanel,
  handleAddRoleForMember,
  handleDelRoleForMember,
  addRoleDirect,
  delRoleDirect,
} = require("./rolePanels");
const { handleAntifastCommand, handleOwnerCommand, handleWhitelistCommand } = require("./antiNukeCommands");
const { isOwner, isBotOwner, getBotOwnerIds } = require("./antiNukeStore");
const { handlePrefixPanel } = require("./prefixPanel");
const { getPrefixes } = require("./prefixStore");
const { sendLog } = require("./actionLogger");
const { validateMassRoleTarget, runMassRole } = require("./massRole");
const { createRateLimiter } = require("./rateLimiter");
const { randomClearJoke } = require("./jokes");
const { playbackErrorMessage } = require("./musicErrors");
const { searchGif } = require("./gifSearch");
const { canControlPlayer, requestPlayerAccess, clearPlayerControl } = require("./playerControl");
const { fetchAllMembers, memberFetchErrorMessage } = require("./guildMembers");

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
// Commandes "." dont l'accès se décide au cas par cas via canUseCommand :
// admin, permission Discord native (ban/unban/unbanall uniquement), ou rôle
// autorisé pour une catégorie de permission qui inclut cette commande précise
// (voir .panel > Permissions, utils/permissionCategoryStore.js — chaque
// catégorie est indépendante, pas de groupe "mod"/"ban" figé).
const DASH_ADMIN_COMMANDS = new Set([
  "renew",
  "hide",
  "unhide",
  "lock",
  "unlock",
  "massrole",
  "addrole",
  "delrole",
  "panel",
  "create",
  "helpall",
  "perms",
]);
// "banall" est gérée à part (permission vérifiée dans son propre handler) :
// contrairement au reste de DASH_ADMIN_COMMANDS, elle n'est PAS assignable à
// une catégorie de permission — bannir tout le serveur est trop destructeur
// pour être délégable autrement qu'à un vrai administrateur.
const DASH_COMMANDS = new Set([...DASH_MEMBER_COMMANDS, ...DASH_ADMIN_COMMANDS, "banall"]);
// Commandes "." dont la permission est aussi vérifiée via canUseCommand (qui
// accepte en plus la permission Discord native "Bannir des membres" pour
// celles-ci spécifiquement — voir utils/permissions.js).
const BAN_COMMANDS = new Set(["ban", "unban", "unbanall"]);
// Commandes "." de config de l'anti-nuke — jamais assignables à une
// catégorie de permission ni gérées via canUseCommand (Administrateur
// natif compris) : leur permission est vérifiée par leur propre handler
// (owners anti-nuke / propriétaire réel du serveur, voir
// utils/antiNukeCommands.js), un cercle volontairement séparé de
// l'Administrateur Discord natif — c'est justement un compte admin
// compromis que ça doit couvrir.
const SECURITY_COMMANDS = new Set(["antifast", "owner", "wl"]);

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

function requireCommandAccess(message, cmd) {
  if (!canUseCommand(message, cmd)) {
    message.reply({
      embeds: [buildStatusEmbed("error", "Tu n'as pas la permission d'utiliser cette commande.")],
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

/**
 * Bannit tous les membres bannissables du serveur (hors bots et hors
 * l'auteur de `.banall`) et édite `statusMessage` avec le résultat — partagé
 * entre le flux "propriétaire tape .banall directement" (confirmation
 * classique) et le flux "owner délégué autorisé par le propriétaire réel"
 * (voir requestBanAllAuthorization).
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Message} message
 * @param {import('discord.js').Message} statusMessage
 */
async function executeBanAll(client, message, statusMessage) {
  await statusMessage
    .edit({ embeds: [buildStatusEmbed("warning", "Bannissement en cours...")], components: [] })
    .catch(() => {});

  try {
    const members = await fetchAllMembers(message.guild);
    const targets = members.filter((m) => !m.user.bot && m.id !== message.author.id && m.bannable);

    let success = 0;
    let failed = 0;
    for (const member of targets.values()) {
      try {
        await member.ban({ reason: `.banall par ${message.author.tag}` });
        success += 1;
      } catch (err) {
        console.error(err);
        failed += 1;
      }
    }

    await statusMessage
      .edit({
        embeds: [buildStatusEmbed("success", `**${success}** membre(s) banni(s)${failed ? ` (${failed} échec(s))` : ""}.`)],
      })
      .catch(() => {});
    sendLog(client, message.guild.id, "moderation", {
      title: "Ban All",
      description: `**${success}** membre(s) banni(s) via \`.banall\`${failed ? ` (${failed} échec(s))` : ""}.`,
      actor: message.author,
    });
  } catch (err) {
    console.error(err);
    await statusMessage
      .edit({
        embeds: [buildStatusEmbed("error", memberFetchErrorMessage(err) || "Une erreur est survenue, réessaie.")],
        components: [],
      })
      .catch(() => {});
  }
}

/**
 * Envoyée quand un "owner" délégué (ajouté via `.owner add`, pas le vrai
 * propriétaire ni un propriétaire du bot) tape `.banall` : ping le
 * propriétaire réel du serveur ET tous les propriétaires du bot, avec des
 * boutons Autoriser/Refuser. Seul l'un d'eux peut répondre ; un "accepter"
 * exécute directement le bannissement (le clic fait office de confirmation,
 * pas besoin d'une seconde étape).
 * @param {import('discord.js').Client} client
 * @param {import('discord.js').Message} message
 */
async function requestBanAllAuthorization(client, message) {
  const guild = message.guild;
  const approverIds = [guild.ownerId, ...getBotOwnerIds().filter((id) => id !== guild.ownerId)];
  const isApprover = (userId) => userId === guild.ownerId || isBotOwner(userId);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("banall_auth:accept").setLabel("Autoriser").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("banall_auth:deny").setLabel("Refuser").setStyle(ButtonStyle.Secondary)
  );

  const authMessage = await message.reply({
    content: approverIds.map((id) => `<@${id}>`).join(" "),
    embeds: [
      buildStatusEmbed(
        "warning",
        `**${message.author.tag}** veut exécuter \`.banall\` (bannir **tous les membres humains** du serveur). Autorises-tu ?`
      ),
    ],
    components: [row],
    allowedMentions: { users: approverIds },
  });

  sendLog(client, guild.id, "securite", {
    title: "Demande d'autorisation .banall",
    description: `**${message.author.tag}** (owner délégué) a demandé à exécuter \`.banall\`.`,
    actor: message.author,
  });

  const collector = authMessage.createMessageComponentCollector({ time: 120_000, max: 1 });

  collector.on("collect", async (i) => {
    try {
      if (!isApprover(i.user.id)) {
        await i.reply({
          content: "Seul le propriétaire du serveur (ou du bot) peut répondre à cette demande.",
          ephemeral: true,
        });
        return;
      }

      if (i.customId === "banall_auth:deny") {
        await i.update({ content: null, embeds: [buildStatusEmbed("info", `Refusé par **${i.user.tag}**.`)], components: [] });
        sendLog(client, guild.id, "securite", {
          title: "Demande .banall refusée",
          description: `**${i.user.tag}** a refusé la demande de **${message.author.tag}**.`,
          actor: i.user,
        });
        return;
      }

      await i.update({
        content: null,
        embeds: [buildStatusEmbed("warning", `Autorisé par **${i.user.tag}** — bannissement en cours...`)],
        components: [],
      });
      sendLog(client, guild.id, "securite", {
        title: "Demande .banall autorisée",
        description: `**${i.user.tag}** a autorisé la demande de **${message.author.tag}**.`,
        actor: i.user,
      });
      await executeBanAll(client, message, authMessage);
    } catch (err) {
      console.error("[banall] Erreur sur la demande d'autorisation :", err);
    }
  });

  collector.on("end", (collected) => {
    if (collected.size === 0) {
      authMessage.edit({ content: null, embeds: [buildStatusEmbed("warning", "Demande expirée.")], components: [] }).catch(() => {});
    }
  });
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
      // Cible quelqu'un d'autre (@membre ou ID) : nécessite l'accès à "clear"
      if (!canUseCommand(message, "clear")) {
        return sendTempReply(
          channel,
          {
            embeds: [
              buildStatusEmbed(
                "error",
                "Tu n'as pas la permission de supprimer les messages d'un autre membre."
              ),
            ],
          },
          15000
        );
      }
    } else {
      // -clear <nombre> : nécessite l'accès à "clear"
      if (!canUseCommand(message, "clear")) {
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

  async helpall(client, message) {
    await sendHelpAllPanel(message);
  },

  async perms(client, message) {
    await sendPermsPanel(message);
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

  // Bannit tous les membres bannissables du serveur (hors bots et hors
  // l'auteur lui-même — pour ne pas se verrouiller dehors sans pouvoir
  // confirmer/annuler ni faire `.unbanall` derrière). Action extrêmement
  // destructrice, jamais assignable via `.panel` > Permissions, à trois
  // niveaux : le propriétaire réel du serveur ou un propriétaire du bot
  // (BOT_OWNER_IDS) l'exécute directement (confirmation classique) ; un
  // owner délégué (ajouté via `.owner add`) déclenche une demande
  // d'autorisation envoyée au propriétaire réel/du bot (voir
  // requestBanAllAuthorization) — rien ne se passe tant que ce n'est pas
  // accepté ; n'importe qui d'autre est juste refusé (pas de rétorsion —
  // retirer les rôles ne marche de toute façon pas si son rôle est au même
  // niveau ou au-dessus de celui du bot, voir utils/antiNuke.js pour la
  // vraie détection anti-nuke générale).
  async banall(client, message) {
    const author = message.author;
    const isTopOwner = author.id === message.guild.ownerId || isBotOwner(author.id);
    const isDelegatedOwner = !isTopOwner && isOwner(message.guild, author.id);

    if (!isTopOwner && !isDelegatedOwner) {
      return message.reply({
        embeds: [buildStatusEmbed("error", "Commande réservée au propriétaire du serveur (ou du bot).")],
      });
    }
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
      return message.reply({ embeds: [buildStatusEmbed("error", "Il me manque la permission **Bannir des membres**.")] });
    }

    if (isDelegatedOwner) {
      return requestBanAllAuthorization(client, message);
    }

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("banall_confirm").setLabel("Bannir tout le monde").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("banall_cancel").setLabel("Annuler").setStyle(ButtonStyle.Secondary)
    );
    const confirmMessage = await message.reply({
      embeds: [
        buildStatusEmbed(
          "warning",
          "**Action irréversible** : ça va bannir **tous les membres humains** du serveur (bots et toi exclus). Confirme dans les 30 secondes."
        ),
      ],
      components: [confirmRow],
    });

    const collector = confirmMessage.createMessageComponentCollector({ time: 30_000, max: 1 });

    collector.on("collect", async (i) => {
      try {
        if (i.user.id !== message.author.id) {
          return i.reply({ content: "Seul l'auteur de la commande peut confirmer.", ephemeral: true });
        }
        if (i.customId === "banall_cancel") {
          return i.update({ embeds: [buildStatusEmbed("info", "Annulé.")], components: [] });
        }

        await i.deferUpdate();
        await executeBanAll(client, message, confirmMessage);
      } catch (err) {
        console.error(err);
        await confirmMessage
          .edit({
            embeds: [buildStatusEmbed("error", memberFetchErrorMessage(err) || "Une erreur est survenue, réessaie.")],
            components: [],
          })
          .catch(() => {});
      }
    });

    collector.on("end", (collected) => {
      if (collected.size === 0) confirmMessage.edit({ components: [] }).catch(() => {});
    });
  },

  // Débannit tous les membres actuellement bannis du serveur. Moins
  // destructeur que `.banall` (ne touche aucun membre actif), donc gérée
  // comme `.ban`/`.unban` : admin, permission "Bannir des membres", ou rôle
  // autorisé via `.panel` > Permissions (vérifié dans le dispatcher, voir
  // BAN_COMMANDS).
  async unbanall(client, message) {
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
      return message.reply({ embeds: [buildStatusEmbed("error", "Il me manque la permission **Bannir des membres**.")] });
    }

    const bans = await message.guild.bans.fetch().catch(() => null);
    if (!bans || bans.size === 0) {
      return message.reply({ embeds: [buildStatusEmbed("info", "Aucun membre banni sur ce serveur.")] });
    }

    const confirmRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("unbanall_confirm").setLabel("Débannir tout le monde").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("unbanall_cancel").setLabel("Annuler").setStyle(ButtonStyle.Secondary)
    );
    const confirmMessage = await message.reply({
      embeds: [buildStatusEmbed("warning", `Ça va débannir **${bans.size}** membre(s). Confirme dans les 30 secondes.`)],
      components: [confirmRow],
    });

    const collector = confirmMessage.createMessageComponentCollector({ time: 30_000, max: 1 });

    collector.on("collect", async (i) => {
      try {
        if (i.user.id !== message.author.id) {
          return i.reply({ content: "Seul l'auteur de la commande peut confirmer.", ephemeral: true });
        }
        if (i.customId === "unbanall_cancel") {
          return i.update({ embeds: [buildStatusEmbed("info", "Annulé.")], components: [] });
        }

        await i.update({ embeds: [buildStatusEmbed("warning", "Débannissement en cours...")], components: [] });

        let success = 0;
        let failed = 0;
        for (const ban of bans.values()) {
          try {
            await message.guild.bans.remove(ban.user.id, `.unbanall par ${message.author.tag}`);
            success += 1;
          } catch (err) {
            console.error(err);
            failed += 1;
          }
        }

        await confirmMessage
          .edit({
            embeds: [
              buildStatusEmbed(
                "success",
                `**${success}** membre(s) débanni(s)${failed ? ` (${failed} échec(s))` : ""}.`
              ),
            ],
          })
          .catch(() => {});
        sendLog(client, message.guild.id, "moderation", {
          title: "Unban All",
          description: `**${success}** membre(s) débanni(s) via \`.unbanall\`${failed ? ` (${failed} échec(s))` : ""}.`,
          actor: message.author,
        });
      } catch (err) {
        console.error(err);
        await confirmMessage
          .edit({ embeds: [buildStatusEmbed("error", "Une erreur est survenue, réessaie.")], components: [] })
          .catch(() => {});
      }
    });

    collector.on("end", (collected) => {
      if (collected.size === 0) confirmMessage.edit({ components: [] }).catch(() => {});
    });
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

    try {
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
    } catch (err) {
      console.error(err);
      await message.channel.send({
        embeds: [
          buildStatusEmbed(
            "error",
            memberFetchErrorMessage(err) || "Impossible de récupérer la liste des membres, réessaie."
          ),
        ],
      });
    }
  },

  async addrole(client, message, args) {
    if (args.length >= 2) return addRoleDirect(message, args[0], args[1]);
    if (args.length === 1) return handleAddRoleForMember(message, args[0]);
    await handleAddRolePanel(message);
  },

  async delrole(client, message, args) {
    if (args.length >= 2) return delRoleDirect(message, args[0], args[1]);
    if (args.length === 1) return handleDelRoleForMember(message, args[0]);
    await handleDelRolePanel(message);
  },

  async antifast(client, message, args) {
    await handleAntifastCommand(message, args);
  },

  async owner(client, message, args) {
    await handleOwnerCommand(message, args);
  },

  async wl(client, message, args) {
    await handleWhitelistCommand(message, args);
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

  // Déclencheurs spéciaux sans préfixe, tous équivalents à ".clear me"
  // (supprime tes propres messages), ouverts à tout le monde (limite gérée
  // dans le handler)
  const SELF_CLEAR_TRIGGERS = new Set(["uo clear", "clear me", "anas clear", "yanis clear"]);
  const lowerContent = content.toLowerCase();
  if (SELF_CLEAR_TRIGGERS.has(lowerContent)) {
    return handlers.clear(client, message, ["me"]);
  }

  // Déclencheur spécial sans préfixe : "add <rôle>" / "del <rôle>" en
  // répondant au message de la cible (ou en la mentionnant) — raccourci de
  // .addrole/.delrole par nom de rôle plutôt que mention/ID. Volontairement
  // strict (cible requise + nom de rôle exact + permission) pour ne pas
  // réagir à une phrase normale qui commencerait par "add"/"del" par hasard ;
  // si une condition ne colle pas, on ignore silencieusement plutôt que de
  // spammer une erreur dans une conversation qui n'était pas une commande.
  const addDelMatch = content.match(/^(add|del)\s+(.+)$/i);
  if (addDelMatch) {
    const action = addDelMatch[1].toLowerCase();
    const roleName = addDelMatch[2].trim().toLowerCase();

    const target =
      message.mentions.members?.first() ||
      (message.reference
        ? await message
            .fetchReference()
            .then((ref) => ref.member || message.guild.members.fetch(ref.author.id).catch(() => null))
            .catch(() => null)
        : null);
    const role = target ? message.guild.roles.cache.find((r) => r.id !== message.guild.id && r.name.toLowerCase() === roleName) : null;

    if (target && role) {
      const permCommand = action === "add" ? "addrole" : "delrole";
      if (canUseCommand(message, permCommand)) {
        return (action === "add" ? addRoleDirect : delRoleDirect)(message, target.id, role.id);
      }
      return;
    }
  }

  // Préfixe "." (configurable via .panel) : commandes membres + modération + ban/unban
  if (content.startsWith(DASH_PREFIX) && !content.startsWith(MAIN_PREFIX)) {
    const [cmdRaw, ...args] = content.slice(DASH_PREFIX.length).trim().split(/\s+/);
    const cmd = (cmdRaw || "").toLowerCase();
    if (cmd === "help") {
      return sendDashHelpPanel(message, DASH_PREFIX);
    }
    if (cmd === "clear") {
      // Permission gérée dans le handler : dépend de la cible (soi-même,
      // quelqu'un d'autre, ou un nombre).
      return handlers.clear(client, message, args);
    }
    if (BAN_COMMANDS.has(cmd)) {
      if (!requireCommandAccess(message, cmd)) return;
      return handlers[cmd](client, message, args);
    }
    if (SECURITY_COMMANDS.has(cmd)) {
      // Permission vérifiée dans chaque handler (isOwner / propriétaire réel).
      return handlers[cmd](client, message, args);
    }
    if (!DASH_COMMANDS.has(cmd)) return;
    if (DASH_ADMIN_COMMANDS.has(cmd) && !requireCommandAccess(message, cmd)) return;
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