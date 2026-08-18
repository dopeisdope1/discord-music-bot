"use strict";

const { getDb } = require("../connection");
const guildSettingsRepo = require("./guildSettingsRepo");

function setChannel(guildId, identityKey, logType, channelId) {
    const db = getDb();
    db.prepare(
        `INSERT INTO log_channels (guild_id, identity_key, log_type, channel_id) VALUES (?, ?, ?, ?)
         ON CONFLICT (guild_id, identity_key, log_type) DO UPDATE SET channel_id = excluded.channel_id`
    ).run(guildId, identityKey, logType, channelId);
}

function getChannel(guildId, identityKey, logType) {
    const db = getDb();
    return db
        .prepare(
            "SELECT channel_id FROM log_channels WHERE guild_id = ? AND identity_key = ? AND log_type = ?"
        )
        .get(guildId, identityKey, logType)?.channel_id;
}

function listAll(guildId, identityKey) {
    const db = getDb();
    return db
        .prepare("SELECT log_type, channel_id FROM log_channels WHERE guild_id = ? AND identity_key = ?")
        .all(guildId, identityKey);
}

function clearType(guildId, identityKey, logType) {
    const db = getDb();
    db.prepare(
        "DELETE FROM log_channels WHERE guild_id = ? AND identity_key = ? AND log_type = ?"
    ).run(guildId, identityKey, logType);
}

// Posts a guard-triggered embed to whichever log channel is configured for this
// guard's identity (falls back to the 'raid' log type, then 'general').
async function postGuardLog(ctx) {
    const { identity, guildId, match, def } = ctx;
    const channelId =
        getChannel(guildId, identity.key, "raid") || getChannel(guildId, identity.key, "general");
    if (!channelId) return;

    const client = ctx.client || match?.guild?.client;
    const channel = await client?.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) return;

    const { EmbedBuilder } = require("discord.js");
    const embed = new EmbedBuilder()
        .setColor(identity.themeColor || "#ED4245")
        .setTitle(`🛡️ Garde déclenchée : ${def?.key || ctx.guardKey || "?"}`)
        .setDescription(match?.description || "Action non autorisée détectée et annulée.")
        .setTimestamp();

    await channel.send({ embeds: [embed] }).catch(() => {});
}

// General-purpose event logger used by the non-guard log event files (join,
// leave, roles, messages, channels, bots, webhooks, emojis, boosts, server,
// invites, ...). Respects the +logs master on/off flag set via guild_bot_settings.
async function postLog(client, identity, guildId, logType, embedOptions) {
    const settings = guildSettingsRepo.getSettings(guildId, identity.key);
    if (settings && settings.logs_master_enabled === 0) return;

    const channelId = getChannel(guildId, identity.key, logType);
    if (!channelId) return;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased?.()) return;

    const { EmbedBuilder } = require("discord.js");
    const embed = new EmbedBuilder()
        .setColor(embedOptions.color || identity.themeColor || "#5865F2")
        .setTitle(embedOptions.title)
        .setTimestamp();
    if (embedOptions.description) embed.setDescription(embedOptions.description);
    if (embedOptions.fields) embed.addFields(embedOptions.fields);

    await channel.send({ embeds: [embed] }).catch(() => {});
}

module.exports = { setChannel, getChannel, listAll, clearType, postGuardLog, postLog };
