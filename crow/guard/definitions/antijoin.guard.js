"use strict";

const { Events } = require("discord.js");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");
const logsConfigRepo = require("../../db/repositories/logsConfigRepo");

const DEFAULT_WINDOW_MS = 10_000;
const DEFAULT_MAX_JOINS = 10;
const RAID_PING_COOLDOWN_MS = 30_000;

// Mass-join raid filter: unlike the other guards there is no single "unauthorized
// actor" to attribute a raid to (many accounts joining fast, not one admin
// action), so this is a rate-based detector instead of an audit-log lookup.
//
// Ephemeral, hot-path state — intentionally NOT persisted to the DB. Keyed per
// (guild, identity) rather than guild alone: each Crow identity runs its own
// discord.js Client, so a single real member join fires GuildMemberAdd once per
// bot present in the guild. Sharing one guild-only counter would multiply the
// apparent join rate by the number of bots installed in that guild.
const recentJoins = new Map();
const lastRaidPing = new Map();

function readSettings(guildId, identityKey) {
    const config = guardConfigRepo.getConfig(guildId, identityKey, "antijoin");
    if (!config?.settings_json) return {};
    try {
        return JSON.parse(config.settings_json) || {};
    } catch {
        return {};
    }
}

module.exports = {
    key: "antijoin",
    discordEvent: Events.GuildMemberAdd,
    async matcher(member) {
        if (!member.guild) return null;

        const identityKey = member.client.identity?.key;
        const guildId = member.guild.id;
        const mapKey = `${guildId}:${identityKey}`;

        const { windowMs } = readSettings(guildId, identityKey);
        const window = Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_WINDOW_MS;

        const now = Date.now();
        const timestamps = (recentJoins.get(mapKey) || []).filter((t) => now - t < window);
        timestamps.push(now);
        recentJoins.set(mapKey, timestamps);

        return {
            guildId,
            client: member.client,
            member,
            joinCount: timestamps.length,
            description: `Afflux massif détecté (${timestamps.length} arrivées récentes)`,
        };
    },
    async condition(ctx) {
        const { match, guildId, identity } = ctx;
        const { maxJoins } = readSettings(guildId, identity.key);
        const max = Number.isFinite(maxJoins) && maxJoins > 0 ? maxJoins : DEFAULT_MAX_JOINS;
        return match.joinCount < max; // true = under threshold = no-op
    },
    async punish(ctx) {
        const { match, guildId, identity, client } = ctx;

        // Contain the joiner — there is no "unauthorized actor" to punish here,
        // just the newly-joined account that tipped the rate over the threshold.
        await match.member.kick("Garde antijoin: afflux massif détecté").catch(() => {});

        try {
            const roleId = guardConfigRepo.getRaidPingRole(guildId, identity.key);
            if (!roleId) return;

            const mapKey = `${guildId}:${identity.key}`;
            const now = Date.now();
            const lastPing = lastRaidPing.get(mapKey) || 0;
            if (now - lastPing < RAID_PING_COOLDOWN_MS) return; // avoid spamming one ping per kicked joiner
            lastRaidPing.set(mapKey, now);

            const channelId = logsConfigRepo.getChannel(guildId, identity.key, "raid");
            if (!channelId) return;

            const channel = await client.channels.fetch(channelId).catch(() => null);
            if (!channel || !channel.isTextBased?.()) return;

            await channel
                .send({ content: `<@&${roleId}> ⚠️ Raid détecté : afflux massif d'arrivées de membres.` })
                .catch(() => {});
        } catch {
            // best-effort raid ping, must never break the guard
        }
    },
};
