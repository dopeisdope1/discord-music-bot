const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const { getBlacklist, addToBlacklist, removeFromBlacklist } = require("./blacklistStore");
const { saveGuildConfig } = require("./configChannel");
const { sendLog } = require("./actionLogger");

const PANEL_TIMEOUT_MS = 10 * 60_000;

function buildBlacklistPanel(guildId, statusText) {
  const entries = getBlacklist(guildId);
  const container = new ContainerBuilder();

  if (statusText) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(statusText));
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  }

  const lines = entries
    .slice(0, 10)
    .map((e) => `<@${e.userId}> (\`${e.userId}\`) — ${e.reason}`)
    .join("\n");
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Blacklist (${entries.length})\n` +
        (entries.length ? lines + (entries.length > 10 ? `\n*+${entries.length - 10} autre(s)*` : "") : "*Vide.*")
    )
  );

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId("blacklist_add_select")
        .setPlaceholder("Ajouter un membre du serveur")
        .setMinValues(1)
        .setMaxValues(1)
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("blacklist_add_id").setLabel("➕ Ajouter par ID").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("blacklist_remove_id").setLabel("🗑️ Retirer").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("blacklist_refresh").setLabel("🔄 Actualiser").setStyle(ButtonStyle.Secondary)
    )
  );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildReasonModal(targetId, targetTag) {
  return new ModalBuilder()
    .setCustomId(`blacklist_reason_modal:${targetId}`)
    .setTitle(`Blacklister ${targetTag}`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Raison")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(300)
      )
    );
}

function buildAddByIdModal() {
  return new ModalBuilder()
    .setCustomId("blacklist_add_id_modal")
    .setTitle("Ajouter par ID")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("userId")
          .setLabel("ID du membre")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(15)
          .setMaxLength(25)
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Raison")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(300)
      )
    );
}

function buildRemoveModal() {
  return new ModalBuilder()
    .setCustomId("blacklist_remove_modal")
    .setTitle("Retirer de la blacklist")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("userId")
          .setLabel("ID du membre")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMinLength(15)
          .setMaxLength(25)
      )
    );
}

/**
 * Ajoute `userId` à la blacklist et le bannit tout de suite s'il est déjà
 * membre du serveur.
 * @returns {Promise<boolean>} true si un bannissement immédiat a été appliqué
 */
async function applyAdd(guild, client, userId, tag, reason, actor) {
  const finalReason = reason || "Aucune raison fournie";
  addToBlacklist(guild.id, userId, { reason: finalReason, addedById: actor.id });
  await saveGuildConfig(guild, ["blacklist"]);
  sendLog(client, guild.id, "blacklist", {
    title: "Ajout blacklist",
    description: `**${tag}** (\`${userId}\`) ajouté à la blacklist.`,
    actor,
    fields: [{ name: "Raison", value: finalReason, inline: false }],
  });

  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || !guild.members.me.permissions.has(PermissionFlagsBits.BanMembers) || !member.bannable) {
    return false;
  }
  return member
    .ban({ reason: `Blacklist : ${finalReason}` })
    .then(() => true)
    .catch(() => false);
}

/**
 * `=blacklist` (sans argument) : panel interactif — menu déroulant pour
 * blacklister un membre déjà sur le serveur, boutons pour ajouter par ID
 * (utile pour quelqu'un qui n'est pas encore là) ou retirer, et actualiser
 * la vue. La permission (owners anti-nuke) est vérifiée avant l'appel de
 * cette fonction, voir utils/blacklistCommands.js.
 * @param {import('discord.js').Message} message
 */
async function handleBlacklistPanel(message) {
  const panelMessage = await message.reply(buildBlacklistPanel(message.guildId));
  const collector = panelMessage.createMessageComponentCollector({ time: PANEL_TIMEOUT_MS });

  collector.on("collect", async (i) => {
    try {
      if (i.user.id !== message.author.id) {
        await i.reply({ content: "Seul l'auteur de la commande peut utiliser ce panel.", ephemeral: true });
        return;
      }

      if (i.isUserSelectMenu() && i.customId === "blacklist_add_select") {
        const target = i.users.first();
        await i.showModal(buildReasonModal(target.id, target.tag));
        const submitted = await i
          .awaitModalSubmit({
            time: PANEL_TIMEOUT_MS,
            filter: (m) => m.customId === `blacklist_reason_modal:${target.id}` && m.user.id === message.author.id,
          })
          .catch(() => null);
        if (!submitted) return;

        const reason = submitted.fields.getTextInputValue("reason").trim();
        const banned = await applyAdd(submitted.guild, submitted.client, target.id, target.tag, reason, message.author);
        await submitted.update(
          buildBlacklistPanel(
            message.guildId,
            `**${target.tag}** ajouté à la blacklist.${banned ? " Déjà présent sur le serveur → banni automatiquement." : ""}`
          )
        );
        return;
      }

      if (i.isButton() && i.customId === "blacklist_add_id") {
        await i.showModal(buildAddByIdModal());
        const submitted = await i
          .awaitModalSubmit({
            time: PANEL_TIMEOUT_MS,
            filter: (m) => m.customId === "blacklist_add_id_modal" && m.user.id === message.author.id,
          })
          .catch(() => null);
        if (!submitted) return;

        const userId = submitted.fields.getTextInputValue("userId").trim().replace(/[<@!>]/g, "");
        const reason = submitted.fields.getTextInputValue("reason").trim();
        if (!/^\d{15,}$/.test(userId)) {
          await submitted.reply({ content: "ID invalide.", ephemeral: true });
          return;
        }

        const user = await submitted.client.users.fetch(userId).catch(() => null);
        const banned = await applyAdd(submitted.guild, submitted.client, userId, user?.tag || userId, reason, message.author);
        await submitted.update(
          buildBlacklistPanel(
            message.guildId,
            `**${user?.tag || userId}** ajouté à la blacklist.${banned ? " Déjà présent sur le serveur → banni automatiquement." : ""}`
          )
        );
        return;
      }

      if (i.isButton() && i.customId === "blacklist_remove_id") {
        await i.showModal(buildRemoveModal());
        const submitted = await i
          .awaitModalSubmit({
            time: PANEL_TIMEOUT_MS,
            filter: (m) => m.customId === "blacklist_remove_modal" && m.user.id === message.author.id,
          })
          .catch(() => null);
        if (!submitted) return;

        const userId = submitted.fields.getTextInputValue("userId").trim().replace(/[<@!>]/g, "");
        const removed = removeFromBlacklist(message.guildId, userId);
        if (removed) {
          await saveGuildConfig(submitted.guild, ["blacklist"]);
          sendLog(submitted.client, message.guildId, "blacklist", {
            title: "Retrait blacklist",
            description: `\`${userId}\` retiré de la blacklist.`,
            actor: message.author,
          });
        }
        await submitted.update(
          buildBlacklistPanel(message.guildId, removed ? `\`${userId}\` retiré de la blacklist.` : `\`${userId}\` n'était pas blacklisté.`)
        );
        return;
      }

      if (i.isButton() && i.customId === "blacklist_refresh") {
        await i.update(buildBlacklistPanel(message.guildId));
        return;
      }
    } catch (err) {
      console.error("[blacklist] Erreur dans le panel :", err);
    }
  });

  collector.on("end", () => {
    panelMessage.edit({ components: [] }).catch(() => {});
  });
}

module.exports = { handleBlacklistPanel };
