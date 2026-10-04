const { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, MessageFlags } = require("discord.js");
const { can } = require("./permissions/engine");
const { refusalReason, card } = require("./banPanel");
const { report } = require("./moderation/actions");
const banAllDmStore = require("./banAllDmStore");

const ID = "banall";

const pending = new Map();
const PENDING_TTL_MS = 15 * 60 * 1000;

// Discord bannit jusqu'à 200 membres par requête via son API de masse.
const BULK_CHUNK = 200;

const BAN_BATCH_SIZE = 5;
const DM_BATCH_SIZE = 15;
const PROGRESS_EVERY = 25;

const pendingMessageCapture = new Set();
const TEXT_CAPTURE_TIMEOUT_MS = 2 * 60 * 1000;

/** Traite `items` par lots concurrents. */
async function runBatched(items, batchSize, worker) {
  for (let i = 0; i < items.length; i += batchSize) {
    await Promise.all(items.slice(i, i + batchSize).map(worker));
  }
}

/**
 * L'API de masse exige "Bannir des membres" ET "Gérer le serveur", là où le
 * bannissement simple se contente de la première.
 */
function canBulkBan(guild) {
  return guild.members.me.permissions.has([
    PermissionFlagsBits.BanMembers,
    PermissionFlagsBits.ManageGuild,
  ]);
}

const chunk = (list, size) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

/**
 * Qui a le droit de lancer un ban de masse : le propriétaire du bot, le
 * propriétaire du serveur, et les membres explicitement autorisés. Le rang
 * sys ne suffit PAS ("moderation.banall" n'est jamais octroyable par rôle —
 * engine.can() applique cette règle telle quelle).
 */
function canBanAll(guild, member) {
  return member.id === guild.ownerId || can(member, "moderation.banall");
}

function rememberRequest(data) {
  const now = Date.now();
  for (const [key, value] of pending) {
    if (now - value.at > PENDING_TTL_MS) pending.delete(key);
  }
  const token = `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  pending.set(token, { ...data, at: now });
  return token;
}

/** Membres réellement bannissables, une fois tous les protégés écartés. */
function bannableMembers(guild, actorId) {
  return [...guild.members.cache.values()].filter(
    (member) => !member.user.bot && member.id !== actorId && refusalReason(guild, member) === null
  );
}

/** -banall message <texte> — configure ce qui est envoyé en DM à chaque membre AVANT de le bannir. */
async function handleBanAllMessage(message, args) {
  const text = args.join(" ").trim();
  if (!text) {
    const current = banAllDmStore.getDmMessage(message.guild.id);
    return message.reply(
      card(message.guild.id, 
        "Message DM du ban de masse",
        current
          ? `Message actuel, envoyé à chacun avant d'être banni :\n\n${current}`
          : "*Aucun message configuré — personne ne reçoit de DM avant d'être banni. `banall message <texte>` pour en définir un.*"
      )
    );
  }
  banAllDmStore.setDmMessage(message.guild.id, text);
  return message.reply(card(message.guild.id, "Message DM du ban de masse enregistré", text));
}

function buildConfirmCard(guild, targets, reason, token) {
  const bulk = canBulkBan(guild);
  const estimate = bulk
    ? `environ **${Math.max(1, Math.ceil((targets.length / BULK_CHUNK) * 2))} seconde(s)**, par lots de ${BULK_CHUNK}`
    : `environ **${Math.max(1, Math.ceil((targets.length / BAN_BATCH_SIZE) * 0.6))} seconde(s)**, par lots de ${BAN_BATCH_SIZE} — ` +
      "donne-moi la permission **Gérer le serveur** pour que ce soit quasi instantané";

  const dmMessage = banAllDmStore.getDmMessage(guild.id);
  const dmEstimate = dmMessage
    ? ` + environ **${Math.max(1, Math.ceil((targets.length / DM_BATCH_SIZE) * 0.6))} seconde(s)** pour les DM avant le ban (lots de ${DM_BATCH_SIZE})`
    : "";

  return card(guild.id, 
    "Confirmer le ban de masse",
    [
      `**${targets.length}** membre(s) seront bannis de **${guild.name}**.`,
      `Raison : ${reason || "*aucune*"}`,
      "",
      `Durée estimée : ${estimate}${dmEstimate}.`,
      dmMessage ? `**Message DM avant chaque ban :**\n> ${dmMessage}` : "*Aucun message configuré — personne ne reçoit de DM avant d'être banni.*",
      "",
      "Sont épargnés : toi, le propriétaire du serveur, les bots, les propriétaires du bot,",
      "les membres de rang sys, et ceux dont le rôle dépasse le mien.",
      "",
      "**Cette action est irréversible.**",
    ].join("\n"),
    [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${ID}:go:${token}`)
          .setLabel(`Bannir ${targets.length} membre(s)`)
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${ID}:no:${token}`).setLabel("Annuler").setStyle(ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${ID}:configmsg:${token}`)
          .setLabel(dmMessage ? "Changer le message DM" : "Configurer le message DM")
          .setStyle(ButtonStyle.Secondary)
      ),
    ]
  );
}

async function handleConfigMessage(interaction, request, token) {
  const guildId = interaction.guild.id;
  const key = `${interaction.user.id}:${guildId}`;
  if (pendingMessageCapture.has(key)) {
    return interaction.reply({ content: "Une saisie est déjà en cours — réponds dans le salon.", flags: MessageFlags.Ephemeral });
  }
  pendingMessageCapture.add(key);

  const channel = interaction.channel;
  await interaction.reply({
    content: `Écris dans ce salon le message à envoyer en DM à chacun avant d'être banni (${TEXT_CAPTURE_TIMEOUT_MS / 1000}s pour répondre).`,
    flags: MessageFlags.Ephemeral,
  });
  await channel.send(`<@${interaction.user.id}> Message à envoyer en DM avant chaque ban :`).catch(() => {});

  try {
    const collected = await channel.awaitMessages({
      filter: (m) => m.author.id === interaction.user.id,
      max: 1,
      time: TEXT_CAPTURE_TIMEOUT_MS,
      errors: ["time"],
    });
    const text = collected.first().content.trim();
    if (text) {
      banAllDmStore.setDmMessage(guildId, text);
      await channel.send(`<@${interaction.user.id}> Message enregistré — il sera envoyé à chacun avant d'être banni.`).catch(() => {});
    }
  } catch {
    await channel.send(`<@${interaction.user.id}> Temps écoulé, rien n'a été changé.`).catch(() => {});
  } finally {
    pendingMessageCapture.delete(key);
  }

  const targets = bannableMembers(interaction.guild, request.actorId);
  await interaction.message?.edit(buildConfirmCard(interaction.guild, targets, request.reason, token)).catch(() => {});
}

async function handleBanAll(client, message, args) {
  if (!canBanAll(message.guild, message.member)) return;

  if ((args[0] || "").toLowerCase() === "message") {
    return handleBanAllMessage(message, args.slice(1));
  }

  const reason = args.join(" ").trim();

  await message.reply(card(message.guild.id, "Ban de masse", "Analyse des membres du serveur en cours…"));

  await message.guild.members.fetch().catch(() => null);
  const targets = bannableMembers(message.guild, message.author.id);

  if (!targets.length) {
    return message.channel.send(card(message.guild.id, "Ban de masse", "Aucun membre ne peut être banni."));
  }

  const token = rememberRequest({ actorId: message.author.id, reason, count: targets.length });

  await message.channel.send(buildConfirmCard(message.guild, targets, reason, token));
}

async function handleBanAllInteraction(interaction) {
  const [, action, token] = interaction.customId.split(":");

  if (!canBanAll(interaction.guild, interaction.member)) {
    return interaction.reply({ content: "Tu n'as pas accès à cette commande.", flags: MessageFlags.Ephemeral });
  }

  const request = pending.get(token);
  if (!request) {
    return interaction.update(card(interaction.guild.id, "Panneau expiré", "Relance la commande pour recommencer."));
  }
  if (interaction.user.id !== request.actorId) {
    return interaction.reply({ content: "Ce panneau n'est pas le tien.", flags: MessageFlags.Ephemeral });
  }

  if (action === "no") {
    pending.delete(token);
    return interaction.update(card(interaction.guild.id, "Ban de masse annulé", null));
  }

  if (action === "configmsg") {
    return handleConfigMessage(interaction, request, token);
  }

  if (action !== "go") return;

  pending.delete(token);

  const guild = interaction.guild;
  const reason = request.reason || `Ban de masse — par ${interaction.user.tag}`;

  const targets = bannableMembers(guild, request.actorId);

  const dmMessage = banAllDmStore.getDmMessage(guild.id);
  if (dmMessage) {
    await interaction.update(card(guild.id, "Ban de masse en cours", `Envoi des messages en DM… 0 / ${targets.length}`));
    let sent = 0;
    await runBatched(targets, DM_BATCH_SIZE, async (member) => {
      await member.send(dmMessage).catch(() => {});
      sent += 1;
      if (sent % PROGRESS_EVERY === 0) {
        await interaction.message
          .edit(card(guild.id, "Ban de masse en cours", `Envoi des messages en DM… ${sent} / ${targets.length}`))
          .catch(() => {});
      }
    });
  } else {
    await interaction.update(card(guild.id, "Ban de masse en cours", `0 / ${targets.length}…`));
  }

  let done = 0;
  let failed = 0;

  if (canBulkBan(guild)) {
    const groups = chunk(targets.map((m) => m.id), BULK_CHUNK);
    for (const [index, ids] of groups.entries()) {
      try {
        const result = await guild.bans.bulkCreate(ids, { reason });
        done += result.bannedUsers.length;
        failed += result.failedUsers.length;
      } catch (err) {
        failed += ids.length;
        console.error("[banall] échec d'un lot :", err.message);
      }
      if (index < groups.length - 1) {
        await interaction.message
          .edit(card(guild.id, "Ban de masse en cours", `${done} / ${targets.length}…`))
          .catch(() => {});
      }
    }
  } else {
    await runBatched(targets, BAN_BATCH_SIZE, async (member) => {
      if (refusalReason(guild, member) !== null) {
        failed += 1;
        return;
      }
      try {
        await member.ban({ reason });
        done += 1;
      } catch (err) {
        failed += 1;
        console.error(`[banall] échec sur ${member.user.tag} :`, err.message);
      }

      if ((done + failed) % PROGRESS_EVERY === 0) {
        await interaction.message
          .edit(card(guild.id, "Ban de masse en cours", `${done} / ${targets.length}…`))
          .catch(() => {});
      }
    });
  }

  console.log(`[banall] ${done} banni(s), ${failed} échec(s) par ${interaction.user.tag} sur "${guild.name}"`);

  if (done > 0) {
    await report(interaction.client, {
      guildId: guild.id,
      title: "Ban de masse",
      fields: [
        { label: "Bannis", value: String(done) },
        ...(failed ? [{ label: "Échecs", value: String(failed) }] : []),
      ],
      action: "banall",
      targetId: null,
      targetTag: `${done} membre(s)`,
      moderator: interaction.user,
      reason,
      channelId: interaction.channelId,
      extra: { done, failed },
    });
  }

  await interaction.message
    .edit(
      card(guild.id, 
        "Ban de masse terminé",
        `**${done}** membre(s) banni(s).${failed ? `\n${failed} échec(s).` : ""}`
      )
    )
    .catch(() => {});
}

module.exports = { handleBanAll, handleBanAllInteraction, canBanAll, ID };
