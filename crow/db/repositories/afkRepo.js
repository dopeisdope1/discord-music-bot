"use strict";

const { getDb } = require("../connection");

function set(guildId, userId, reason) {
    const db = getDb();
    db.prepare(
        `INSERT INTO afk (guild_id, user_id, reason, since) VALUES (?, ?, ?, ?)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET reason = excluded.reason, since = excluded.since`
    ).run(guildId, userId, reason || null, Date.now());
}

function get(guildId, userId) {
    const db = getDb();
    return db.prepare("SELECT * FROM afk WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
}

function remove(guildId, userId) {
    const db = getDb();
    const result = db.prepare("DELETE FROM afk WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
    return Number(result.changes) > 0;
}

module.exports = { set, get, remove };
