"use strict";

const { getDb } = require("../connection");

function create({ userId, guildId, channelId, remindAt, content }) {
    const db = getDb();
    const result = db
        .prepare(
            `INSERT INTO reminders (user_id, guild_id, channel_id, remind_at, content, created_at, delivered)
             VALUES (?, ?, ?, ?, ?, ?, 0)`
        )
        .run(userId, guildId || null, channelId, remindAt, content, Date.now());
    return Number(result.lastInsertRowid);
}

function getDuePending(now) {
    const db = getDb();
    return db.prepare("SELECT * FROM reminders WHERE delivered = 0 AND remind_at <= ?").all(now);
}

function markDelivered(id) {
    const db = getDb();
    db.prepare("UPDATE reminders SET delivered = 1 WHERE id = ?").run(id);
}

function listByUser(userId) {
    const db = getDb();
    return db
        .prepare("SELECT * FROM reminders WHERE user_id = ? AND delivered = 0 ORDER BY remind_at ASC")
        .all(userId);
}

function cancel(id, userId) {
    const db = getDb();
    const result = db
        .prepare("DELETE FROM reminders WHERE id = ? AND user_id = ?")
        .run(id, userId);
    return Number(result.changes) > 0;
}

module.exports = { create, getDuePending, markDelivered, listByUser, cancel };
