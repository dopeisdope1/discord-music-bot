"use strict";

const { EmbedBuilder } = require("discord.js");
const giveawayRepo = require("../db/repositories/giveawayRepo");

function pickWinners(entries, count) {
    const pool = [...entries];
    const winners = [];
    while (winners.length < count && pool.length > 0) {
        const idx = Math.floor(Math.random() * pool.length);
        winners.push(pool.splice(idx, 1)[0]);
    }
    return winners;
}

async function endGiveaway(client, giveaway) {
    giveawayRepo.markEnded(giveaway.id);

    const channel = await client.channels.fetch(giveaway.channel_id).catch(() => null);
    if (!channel) return [];

    const entries = giveawayRepo.listEntries(giveaway.id);
    const winners = pickWinners(entries, giveaway.winners_count);

    const resultEmbed = new EmbedBuilder()
        .setColor(winners.length ? "#57F287" : "#ED4245")
        .setTitle(`🎉 Giveaway terminé : ${giveaway.prize}`)
        .setDescription(
            winners.length
                ? `Félicitations ${winners.map((id) => `<@${id}>`).join(", ")} !`
                : "Personne n'a participé."
        )
        .setTimestamp();

    await channel.send({ embeds: [resultEmbed] }).catch(() => {});

    if (giveaway.message_id) {
        const message = await channel.messages.fetch(giveaway.message_id).catch(() => null);
        await message?.edit({ embeds: [resultEmbed], components: [] }).catch(() => {});
    }

    return winners;
}

// setInterval (not setTimeout): state persists across restarts via ends_at in
// SQLite, and there's no Node ~24.8-day max-delay ceiling to worry about for
// long-running giveaways.
function startSweeper(client, { intervalMs = 15_000 } = {}) {
    setInterval(() => {
        const expired = giveawayRepo.listExpiredActive(Date.now());
        for (const giveaway of expired) {
            endGiveaway(client, giveaway).catch(() => {});
        }
    }, intervalMs);
}

module.exports = { endGiveaway, pickWinners, startSweeper };
