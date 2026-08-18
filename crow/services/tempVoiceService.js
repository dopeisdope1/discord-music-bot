"use strict";

const { ChannelType } = require("discord.js");
const voiceRepo = require("../db/repositories/voiceRepo");
const logsConfigRepo = require("../db/repositories/logsConfigRepo");

async function handleVoiceStateUpdate(oldState, newState, identity) {
    const guild = newState.guild || oldState.guild;
    const config = voiceRepo.getConfig(guild.id);
    if (!config) return;

    if (newState.channelId && config.hub_channel_id && newState.channelId === config.hub_channel_id) {
        await createTempChannelFor(newState, config, identity);
    }

    if (oldState.channelId && oldState.channelId !== newState.channelId) {
        const info = voiceRepo.getChannel(oldState.channelId);
        if (info && info.is_temp) {
            const channel = oldState.guild.channels.cache.get(oldState.channelId);
            if (channel && channel.members.size === 0) {
                await channel.delete("Salon vocal temporaire vide").catch(() => {});
                voiceRepo.deleteChannel(oldState.channelId);

                if (identity) {
                    await logsConfigRepo.postLog(oldState.client, identity, guild.id, "tempvoc", {
                        title: "🔊 Salon vocal temporaire supprimé (vide)",
                        color: "#99AAB5",
                        fields: [{ name: "Salon", value: channel.name }],
                    });
                }
            }
        }
    }
}

async function createTempChannelFor(voiceState, config, identity) {
    const guild = voiceState.guild;
    const member = voiceState.member;

    // voice_config is guild-scoped, not identity-scoped — if a guild runs both
    // crowall and crowmaster, both clients receive the same hub-join event
    // independently. Check for an already-owned temp channel first so a
    // restart/lag doesn't spawn a duplicate.
    const existing = voiceRepo
        .listByGuild(guild.id)
        .find((c) => c.is_temp && c.owner_id === member.id && guild.channels.cache.has(c.channel_id));
    if (existing) {
        const channel = guild.channels.cache.get(existing.channel_id);
        await member.voice.setChannel(channel).catch(() => {});
        return channel;
    }

    const channel = await guild.channels.create({
        name: `🔊 ${member.displayName}`,
        type: ChannelType.GuildVoice,
        parent: config.category_id || undefined,
    });

    // Re-check after the (async) Discord API call in case a second identity
    // won the race while this channel was being created — if so, drop the
    // duplicate and move the member into the winning channel instead.
    const raceWinner = voiceRepo
        .listByGuild(guild.id)
        .find(
            (c) =>
                c.is_temp &&
                c.owner_id === member.id &&
                c.channel_id !== channel.id &&
                guild.channels.cache.has(c.channel_id)
        );
    if (raceWinner) {
        await channel.delete("Doublon: un autre bot a déjà créé un salon temporaire pour ce membre").catch(() => {});
        const winnerChannel = guild.channels.cache.get(raceWinner.channel_id);
        await member.voice.setChannel(winnerChannel).catch(() => {});
        return winnerChannel;
    }

    voiceRepo.createChannel({ channelId: channel.id, guildId: guild.id, ownerId: member.id, isTemp: true });
    await member.voice.setChannel(channel).catch(() => {});

    if (identity) {
        await logsConfigRepo.postLog(guild.client, identity, guild.id, "tempvoc", {
            title: "🔊 Salon vocal temporaire créé",
            color: "#57F287",
            fields: [
                { name: "Propriétaire", value: `${member} (${member.id})` },
                { name: "Salon", value: channel.name },
            ],
        });
    }

    return channel;
}

module.exports = { handleVoiceStateUpdate, createTempChannelFor };
