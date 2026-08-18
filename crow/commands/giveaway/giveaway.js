"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const giveawayRepo = require("../../db/repositories/giveawayRepo");
const { registerButtonHandler } = require("../../core/interactionRegistry");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { parseDuration, formatDuration } = require("../../utils/time");

// Registered once at module load — dispatched by events/interactionCreate.event.js
// for any button whose customId starts with "giveaway:".
registerButtonHandler("giveaway", async (interaction) => {
    const giveawayId = Number(interaction.customId.split(":")[1]);
    const giveaway = giveawayRepo.getById(giveawayId);
    if (!giveaway || giveaway.ended) {
        return interaction.reply({ content: "Ce giveaway est terminé.", ephemeral: true });
    }
    if (giveawayRepo.hasEntry(giveawayId, interaction.user.id)) {
        giveawayRepo.removeEntry(giveawayId, interaction.user.id);
        return interaction.reply({ content: "❌ Participation retirée.", ephemeral: true });
    }
    giveawayRepo.addEntry(giveawayId, interaction.user.id);
    return interaction.reply({ content: "🎉 Participation enregistrée !", ephemeral: true });
});

module.exports = {
    name: "giveaway",
    category: "giveaway",
    description: "Crée un giveaway configurable.",
    permLevel: LEVEL.STAFF,
    aliases: [],
    async execute(ctx) {
        const durationRaw = ctx.args[0];
        const winnersRaw = ctx.args[1];
        const prize = ctx.args.slice(2).join(" ");

        if (!durationRaw || !winnersRaw || !prize) {
            throw new UsageError("giveaway <durée> <gagnants> <lot>");
        }

        const durationMs = parseDuration(durationRaw);
        if (!durationMs) throw new UsageError("giveaway <durée> <gagnants> <lot>");

        const winnersCount = Number(winnersRaw);
        if (!Number.isInteger(winnersCount) || winnersCount < 1) {
            throw new UsageError("giveaway <durée> <gagnants> <lot>");
        }

        const endsAt = Date.now() + durationMs;

        // Create the DB row first so we have a real id to bake into the
        // button's customId before the message is ever sent.
        const id = giveawayRepo.create({
            guildId: ctx.guildId,
            channelId: ctx.message.channel.id,
            prize,
            winnersCount,
            endsAt,
            hostId: ctx.author.id,
        });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`giveaway:${id}`)
                .setLabel("🎉 Participer")
                .setStyle(ButtonStyle.Success)
        );

        const embed = ctx.embed({
            title: "🎉 GIVEAWAY 🎉",
            description: "Cliquez sur le bouton ci-dessous pour participer !",
            fields: [
                { name: "Lot", value: prize, inline: true },
                { name: "Gagnants", value: String(winnersCount), inline: true },
                { name: "Fin", value: `<t:${Math.floor(endsAt / 1000)}:R>`, inline: true },
                { name: "Organisé par", value: `<@${ctx.author.id}>`, inline: true },
            ],
            footer: `Giveaway #${id}`,
        });

        const message = await ctx.send({ embeds: [embed], components: [row] });
        if (message) {
            giveawayRepo.setMessageId(id, message.id);
        }
    },
};
