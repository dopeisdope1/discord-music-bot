"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const ticketRepo = require("../../db/repositories/ticketRepo");
const ticketService = require("../../services/ticketService");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractChannelId, extractRoleId } = require("../../utils/args");
const { registerButtonHandler } = require("../../core/interactionRegistry");

// Registered once at module load so interactionCreate.event.js routes
// "ticket:*" button clicks here regardless of which identity's message loaded
// this file first.
registerButtonHandler("ticket", async (interaction, client, identity) => {
    const [, action] = interaction.customId.split(":");

    if (action === "open") {
        const channel = await ticketService.createTicket(interaction.guild, interaction.user).catch((e) => {
            interaction.reply({ content: `❌ ${e.message}`, ephemeral: true }).catch(() => {});
            return null;
        });

        if (channel) {
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("ticket:claim").setLabel("🙋 Prendre en charge").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId("ticket:close").setLabel("🔒 Fermer").setStyle(ButtonStyle.Danger)
            );
            await channel
                .send({
                    content: `${interaction.user}`,
                    embeds: [
                        {
                            color: 0x5865f2,
                            title: "🎫 Ticket ouvert",
                            description: "Un membre du staff va bientôt te répondre. Utilise les boutons ci-dessous pour gérer ce ticket.",
                            footer: { text: identity?.displayName || "" },
                        },
                    ],
                    components: [row],
                })
                .catch(() => {});
            await interaction.reply({ content: `✅ Ticket créé : ${channel}`, ephemeral: true }).catch(() => {});
        }
    } else if (action === "close") {
        await ticketService.closeTicket(interaction.channel, interaction.user).catch((e) => {
            interaction.reply({ content: `❌ ${e.message}`, ephemeral: true }).catch(() => {});
        });
    } else if (action === "claim") {
        ticketService.claimTicket(interaction.channel, interaction.user);
        await interaction.reply({ content: `🎫 Ticket pris en charge par ${interaction.user}.` }).catch(() => {});
    }
});

module.exports = {
    name: "ticket",
    category: "owner",
    description: "Gère le système de tickets de support.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const sub = ctx.args[0]?.toLowerCase();
        const usage = "ticket setup #catégorie [@rôle staff] | ticket panel [#salon]";

        if (sub === "setup") {
            const categoryId = extractChannelId(ctx.args[1]);
            if (!categoryId) throw new UsageError(usage);

            ticketRepo.setConfigField(ctx.guildId, "category_id", categoryId);

            const roleId = extractRoleId(ctx.args[2]);
            if (roleId) ticketRepo.setConfigField(ctx.guildId, "staff_role_id", roleId);

            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "🎫 Tickets configurés",
                        description: [`Catégorie : <#${categoryId}>`, roleId ? `Rôle staff : <@&${roleId}>` : null]
                            .filter(Boolean)
                            .join("\n"),
                    }),
                ],
            });
        } else if (sub === "panel") {
            const channelId = extractChannelId(ctx.args[1]) || ctx.message.channel.id;
            const channel = ctx.guild.channels.cache.get(channelId);
            if (!channel || !channel.isTextBased()) throw new BotError("Salon introuvable ou non textuel.");

            ticketRepo.setConfigField(ctx.guildId, "panel_channel_id", channel.id);

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("ticket:open").setLabel("🎫 Ouvrir un ticket").setStyle(ButtonStyle.Primary)
            );

            await channel.send({
                embeds: [ctx.embed({ title: "🎫 Support", description: "Clique sur le bouton ci-dessous pour ouvrir un ticket." })],
                components: [row],
            });

            await ctx.reply(`✅ Panel de tickets envoyé dans ${channel}.`);
        } else {
            throw new UsageError(usage);
        }
    },
};
