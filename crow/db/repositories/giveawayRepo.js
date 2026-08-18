"use strict";

const { getDb } = require("../connection");

function create({ guildId, channelId, prize, winnersCount, endsAt, hostId }) {
    const db = getDb();
    const result = db
        .prepare(
            `INSERT INTO giveaways (guild_id, channel_id, prize, winners_count, ends_at, host_id, ended, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
        )
        .run(guildId, channelId, prize, winnersCount, endsAt, hostId, Date.now());
    return Number(result.lastInsertRowid);
}

function setMessageId(id, messageId) {
    const db = getDb();
    db.prepare("UPDATE giveaways SET message_id = ? WHERE id = ?").run(messageId, id);
}

function getById(id) {
    const db = getDb();
    return db.prepare("SELECT * FROM giveaways WHERE id = ?").get(id);
}

function listActive(guildId) {
    const db = getDb();
    return db.prepare("SELECT * FROM giveaways WHERE guild_id = ? AND ended = 0").all(guildId);
}

function listExpiredActive(now) {
    const db = getDb();
    return db.prepare("SELECT * FROM giveaways WHERE ended = 0 AND ends_at <= ?").all(now);
}

function markEnded(id) {
    const db = getDb();
    db.prepare("UPDATE giveaways SET ended = 1 WHERE id = ?").run(id);
}

function addEntry(giveawayId, userId) {
    const db = getDb();
    db.prepare(
        "INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id, entered_at) VALUES (?, ?, ?)"
    ).run(giveawayId, userId, Date.now());
}

function removeEntry(giveawayId, userId) {
    const db = getDb();
    db.prepare("DELETE FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?").run(
        giveawayId,
        userId
    );
}

function listEntries(giveawayId) {
    const db = getDb();
    return db
        .prepare("SELECT user_id FROM giveaway_entries WHERE giveaway_id = ?")
        .all(giveawayId)
        .map((r) => r.user_id);
}

function hasEntry(giveawayId, userId) {
    const db = getDb();
    return Boolean(
        db
            .prepare("SELECT 1 FROM giveaway_entries WHERE giveaway_id = ? AND user_id = ?")
            .get(giveawayId, userId)
    );
}

module.exports = {
    create,
    setMessageId,
    getById,
    listActive,
    listExpiredActive,
    markEnded,
    addEntry,
    removeEntry,
    listEntries,
    hasEntry,
};
