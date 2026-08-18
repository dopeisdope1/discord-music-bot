"use strict";

const { getDb } = require("../connection");

function getConfig(guildId) {
    const db = getDb();
    return db.prepare("SELECT * FROM voice_config WHERE guild_id = ?").get(guildId);
}

function ensureConfig(guildId) {
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO voice_config (guild_id) VALUES (?)").run(guildId);
}

function setConfigField(guildId, field, value) {
    const allowed = new Set([
        "hub_channel_id",
        "category_id",
        "move_channel_id",
        "stats_channel_id",
        "greet_channel_id",
        "deco_mode",
    ]);
    if (!allowed.has(field)) throw new Error(`voiceRepo.setConfigField: unknown field "${field}"`);

    ensureConfig(guildId);
    const db = getDb();
    db.prepare(`UPDATE voice_config SET ${field} = ? WHERE guild_id = ?`).run(value, guildId);
}

function clearConfig(guildId) {
    const db = getDb();
    db.prepare("DELETE FROM voice_config WHERE guild_id = ?").run(guildId);
}

function createChannel({ channelId, guildId, ownerId, isTemp = true, userLimit = null }) {
    const db = getDb();
    db.prepare(
        `INSERT INTO voice_channels (channel_id, guild_id, owner_id, is_temp, locked, user_limit, created_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`
    ).run(channelId, guildId, ownerId, isTemp ? 1 : 0, userLimit, Date.now());
}

function getChannel(channelId) {
    const db = getDb();
    return db.prepare("SELECT * FROM voice_channels WHERE channel_id = ?").get(channelId);
}

function listByGuild(guildId) {
    const db = getDb();
    return db.prepare("SELECT * FROM voice_channels WHERE guild_id = ?").all(guildId);
}

function setOwner(channelId, ownerId) {
    const db = getDb();
    db.prepare("UPDATE voice_channels SET owner_id = ? WHERE channel_id = ?").run(ownerId, channelId);
}

function setLocked(channelId, locked) {
    const db = getDb();
    db.prepare("UPDATE voice_channels SET locked = ? WHERE channel_id = ?").run(locked ? 1 : 0, channelId);
}

function setUserLimit(channelId, limit) {
    const db = getDb();
    db.prepare("UPDATE voice_channels SET user_limit = ? WHERE channel_id = ?").run(limit, channelId);
}

function deleteChannel(channelId) {
    const db = getDb();
    db.prepare("DELETE FROM voice_channels WHERE channel_id = ?").run(channelId);
    db.prepare("DELETE FROM voice_access WHERE channel_id = ?").run(channelId);
}

function setAccess(channelId, userId, mode) {
    const db = getDb();
    db.prepare(
        `INSERT INTO voice_access (channel_id, user_id, mode) VALUES (?, ?, ?)
         ON CONFLICT (channel_id, user_id) DO UPDATE SET mode = excluded.mode`
    ).run(channelId, userId, mode);
}

function clearAccess(channelId, userId) {
    const db = getDb();
    db.prepare("DELETE FROM voice_access WHERE channel_id = ? AND user_id = ?").run(channelId, userId);
}

function listAccess(channelId) {
    const db = getDb();
    return db.prepare("SELECT user_id, mode FROM voice_access WHERE channel_id = ?").all(channelId);
}

// --- guild-wide voice privilege ban ---

function ban(guildId, userId, bannedBy) {
    const db = getDb();
    db.prepare(
        `INSERT INTO voice_bans (guild_id, user_id, banned_by, banned_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (guild_id, user_id) DO NOTHING`
    ).run(guildId, userId, bannedBy, Date.now());
}

function unban(guildId, userId) {
    const db = getDb();
    const result = db.prepare("DELETE FROM voice_bans WHERE guild_id = ? AND user_id = ?").run(
        guildId,
        userId
    );
    return Number(result.changes) > 0;
}

function isBanned(guildId, userId) {
    const db = getDb();
    return Boolean(
        db.prepare("SELECT 1 FROM voice_bans WHERE guild_id = ? AND user_id = ?").get(guildId, userId)
    );
}

function resetAllBans(guildId) {
    const db = getDb();
    const result = db.prepare("DELETE FROM voice_bans WHERE guild_id = ?").run(guildId);
    return Number(result.changes);
}

// --- voice whitelist (bypass temp-voice restrictions) ---

function whitelistAdd(guildId, userId) {
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO voice_whitelist (guild_id, user_id) VALUES (?, ?)").run(
        guildId,
        userId
    );
}

function whitelistRemove(guildId, userId) {
    const db = getDb();
    db.prepare("DELETE FROM voice_whitelist WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
}

function whitelistList(guildId) {
    const db = getDb();
    return db
        .prepare("SELECT user_id FROM voice_whitelist WHERE guild_id = ?")
        .all(guildId)
        .map((r) => r.user_id);
}

module.exports = {
    getConfig,
    ensureConfig,
    setConfigField,
    clearConfig,
    createChannel,
    getChannel,
    listByGuild,
    setOwner,
    setLocked,
    setUserLimit,
    deleteChannel,
    setAccess,
    clearAccess,
    listAccess,
    ban,
    unban,
    isBanned,
    resetAllBans,
    whitelistAdd,
    whitelistRemove,
    whitelistList,
};
