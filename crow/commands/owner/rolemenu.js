"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractChannelId, extractRoleId } = require("../../utils/args");
const { registerButtonHandler } = require("../../core/interactionRegistry");

// Registered once at module load — routes any "rolemenu:<roleId>" button click,
// toggling that role on the clicking member. Pragmatic, not exhaustive (no
// mutually-exclusive-role-group support, etc).
registerButtonHandler("rolemenu", async (interaction) => {
    const roleId = interaction.customId.split(":")[1];
    const member = interaction.member;

    try {
        if (member.roles.cache.has(roleId)) {
            await member.roles.remove(roleId);
            await interaction.reply({ content: "Rôle retiré.", ephemeral: true });
        } else {
            await member.roles.add(roleId);
            await interaction.reply({ content: "Rôle ajouté.", ephemeral: true });
        }
    } catch {
        await interaction.reply({ content: "❌ Impossible de modifier ce rôle (hiérarchie ou permissions).", ephemeral: true }).catch(() => {});
    }
});

module.exports = {
    name: "rolemenu",
    category: "owner",
    description: "Gère les menus de rôles par réactions/boutons.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const sub = ctx.args[0]?.toLowerCase();

        if (sub === "create") {
            const channelId = extractChannelId(ctx.args[1]);
            const title = ctx.args.slice(2).join(" ");
            if (!channelId || !title) throw new UsageError("rolemenu create #salon <titre>");

            const channel = ctx.guild.channels.cache.get(channelId);
            if (!channel || !channel.isTextBased()) throw new BotError("Salon introuvable ou non textuel.");

            const msg = await channel.send({
                embeds: [
                    ctx.embed({
                        title: `🎭 ${title}`,
                        description: "Clique sur un bouton ci-dessous pour obtenir ou retirer un rôle.",
                    }),
                ],
            });

            await ctx.reply(
                `✅ Menu de rôles créé : ${msg.url}\nUtilise \`rolemenu addrole ${msg.id} @role <label>\` (dans ${channel}) pour ajouter des boutons.`
            );
        } else if (sub === "addrole") {
            const messageId = ctx.args[1];
            const roleId = extractRoleId(ctx.args[2]);
            const label = ctx.args.slice(3).join(" ") || "Rôle";
            if (!messageId || !roleId) throw new UsageError("rolemenu addrole <messageId> @role <label> (à exécuter dans le salon du menu)");

            const role = ctx.guild.roles.cache.get(roleId);
            if (!role) throw new BotError("Rôle introuvable sur ce serveur.");

            const message = await ctx.message.channel.messages.fetch(messageId).catch(() => null);
            if (!message) {
                throw new BotError("Message introuvable dans ce salon — exécute cette commande dans le même salon que le menu de rôles.");
            }

            const existingButtons = message.components.flatMap((row) => row.components.map((c) => ButtonBuilder.from(c)));
            if (existingButtons.length >= 25) throw new BotError("Ce menu a déjà le nombre maximum de boutons (25).");

            existingButtons.push(
                new ButtonBuilder().setCustomId(`rolemenu:${role.id}`).setLabel(label).setStyle(ButtonStyle.Primary)
            );

            const rows = [];
            for (let i = 0; i < existingButtons.length; i += 5) {
                rows.push(new ActionRowBuilder().addComponents(existingButtons.slice(i, i + 5)));
            }

            await message.edit({ components: rows });
            await ctx.reply(`✅ Bouton "${label}" ajouté pour le rôle ${role}.`);
        } else {
            throw new UsageError("rolemenu <create #salon <titre> | addrole <messageId> @role <label>>");
        }
    },
};
