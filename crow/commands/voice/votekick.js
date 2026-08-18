"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { extractUserId } = require("../../utils/args");
const { UsageError, BotError } = require("../../core/errors");
const { registerButtonHandler } = require("../../core/interactionRegistry");
const logsConfigRepo = require("../../db/repositories/logsConfigRepo");

const VOTE_THRESHOLD = 3; // fixed vote count needed, regardless of channel size
const VOTE_TIMEOUT_MS = 60_000;

// sessionId -> { targetId, channelId, guildId, voters: Set<userId>, identity, timeout }
const sessions = new Map();

function buildRow(sessionId, voteCount) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`votekick:${sessionId}`)
            .setLabel(`🦶 Voter pour exclure (${voteCount}/${VOTE_THRESHOLD})`)
            .setStyle(ButtonStyle.Danger)
    );
}

module.exports = {
    name: "votekick",
    category: "voice",
    description: "Lance un vote pour exclure un membre du salon vocal actuel.",
    permLevel: 0,
    async execute(ctx) {
        const voiceChannel = ctx.member.voice.channel;
        if (!voiceChannel) throw new UsageError("Rejoins d'abord un salon vocal.");

        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("votekick @membre");

        const targetMember = voiceChannel.members.get(targetId);
        if (!targetMember) throw new BotError("Ce membre n'est pas dans ton salon vocal.");
        if (targetId === ctx.author.id) throw new BotError("Tu ne peux pas lancer un vote contre toi-même.");

        const sessionId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
        const message = await ctx.send({
            content: `🗳️ Vote lancé pour exclure ${targetMember} du vocal — ${VOTE_THRESHOLD} votes requis (60s).`,
            components: [buildRow(sessionId, 0)],
        });

        const session = {
            targetId,
            channelId: voiceChannel.id,
            guildId: ctx.guildId,
            identity: ctx.identity,
            voters: new Set(),
            messageId: message?.id,
        };
        session.timeout = setTimeout(() => {
            sessions.delete(sessionId);
            message?.edit({ content: `🗳️ Vote expiré contre ${targetMember} (pas assez de votes).`, components: [] }).catch(() => {});
        }, VOTE_TIMEOUT_MS);

        sessions.set(sessionId, session);
    },
};

registerButtonHandler("votekick", async (interaction) => {
    const sessionId = interaction.customId.split(":")[1];
    const session = sessions.get(sessionId);
    if (!session) {
        return interaction.reply({ content: "Ce vote n'est plus actif.", ephemeral: true });
    }

    const voiceChannel = interaction.guild.channels.cache.get(session.channelId);
    if (!voiceChannel || !voiceChannel.members.has(interaction.user.id)) {
        return interaction.reply({ content: "Tu dois être dans le même salon vocal pour voter.", ephemeral: true });
    }
    if (interaction.user.id === session.targetId) {
        return interaction.reply({ content: "Tu ne peux pas voter contre toi-même.", ephemeral: true });
    }

    if (session.voters.has(interaction.user.id)) {
        return interaction.reply({ content: "Tu as déjà voté.", ephemeral: true });
    }
    session.voters.add(interaction.user.id);

    if (session.voters.size >= VOTE_THRESHOLD) {
        clearTimeout(session.timeout);
        sessions.delete(sessionId);

        const targetMember = voiceChannel.members.get(session.targetId);
        await targetMember?.voice.disconnect("Vote d'exclusion vocale").catch(() => {});

        await interaction.update({
            content: `✅ ${targetMember ? targetMember.user.tag : "Le membre"} a été exclu du vocal (vote réussi).`,
            components: [],
        });

        await logsConfigRepo.postLog(interaction.client, session.identity, session.guildId, "votekick", {
            title: "🦶 Vote d'exclusion vocale réussi",
            color: "#ED4245",
            fields: [
                { name: "Membre exclu", value: `<@${session.targetId}>` },
                { name: "Votants", value: String(session.voters.size) },
            ],
        });
        return;
    }

    await interaction.update({
        content: interaction.message.content,
        components: [buildRow(sessionId, session.voters.size)],
    });
});
