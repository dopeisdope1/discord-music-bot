"use strict";

const { getDb } = require("../connection");

function create(guildId, name, response, createdBy) {
    const db = getDb();
    db.prepare(
        `INSERT INTO custom_commands (guild_id, name, response, created_by, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (guild_id, name) DO UPDATE SET response = excluded.response, created_by = excluded.created_by, created_at = excluded.created_at`
    ).run(guildId, name.toLowerCase(), response, createdBy, Date.now());
}

function get(guildId, name) {
    const db = getDb();
    return db
        .prepare("SELECT * FROM custom_commands WHERE guild_id = ? AND name = ?")
        .get(guildId, name.toLowerCase());
}

function remove(guildId, name) {
    const db = getDb();
    const result = db
        .prepare("DELETE FROM custom_commands WHERE guild_id = ? AND name = ?")
        .run(guildId, name.toLowerCase());
    return Number(result.changes) > 0;
}

function list(guildId) {
    const db = getDb();
    return db.prepare("SELECT name, response FROM custom_commands WHERE guild_id = ?").all(guildId);
}

module.exports = { create, get, remove, list };
