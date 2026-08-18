"use strict";

const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { registerButtonHandler } = require("../../core/interactionRegistry");

// messageId -> { question, yes: Set<userId>, no: Set<userId> }. In-memory only:
// votes/poll state resets on process restart, and this doesn't use reactions
// (would need an extra gateway intent) — two buttons instead, with per-user
// toggle voting tracked here.
const activePolls = new Map();

function buildRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("poll:yes").setLabel("👍").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("poll:no").setLabel("👎").setStyle(ButtonStyle.Danger)
    );
}

function buildPollEmbed(poll, color, footer) {
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle("📊 Sondage")
        .setDescription(poll.question)
        .addFields(
            { name: "👍 Pour", value: String(poll.yes.size), inline: true },
            { name: "👎 Contre", value: String(poll.no.size), inline: true }
        )
        .setTimestamp();
    if (footer) embed.setFooter({ text: footer });
    return embed;
}

module.exports = {
    name: "poll",
    category: "gestion",
    description: "Crée un sondage pour le serveur.",
    permLevel: LEVEL.STAFF,
    aliases: [],
    async execute(ctx) {
        const question = ctx.args.join(" ").trim();
        if (!question) throw new UsageError("poll [question]");

        const poll = { question, yes: new Set(), no: new Set() };

        const sent = await ctx.send({
            embeds: [
                ctx.embed({
                    title: "📊 Sondage",
                    description: question,
                    fields: [
                        { name: "👍 Pour", value: "0", inline: true },
                        { name: "👎 Contre", value: "0", inline: true },
                    ],
                }),
            ],
            components: [buildRow()],
        });

        if (sent) activePolls.set(sent.id, poll);
    },
};

registerButtonHandler("poll", async (interaction) => {
    const poll = activePolls.get(interaction.message.id);
    if (!poll) {
        await interaction.reply({ content: "Ce sondage n'est plus actif.", ephemeral: true });
        return;
    }

    const choice = interaction.customId === "poll:yes" ? "yes" : "no";
    const other = choice === "yes" ? "no" : "yes";
    const userId = interaction.user.id;

    if (poll[choice].has(userId)) {
        poll[choice].delete(userId);
    } else {
        poll[choice].add(userId);
        poll[other].delete(userId);
    }

    const existing = interaction.message.embeds[0];
    const color = existing?.color ?? 0x5865f2;
    const footer = existing?.footer?.text;

    await interaction.update({ embeds: [buildPollEmbed(poll, color, footer)], components: [buildRow()] });
});
