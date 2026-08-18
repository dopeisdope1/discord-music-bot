"use strict";

const { getDb } = require("../connection");

function set(guildId, userId, { antiMute = false, antiUnmute = false, notifyDm = false, setBy }) {
    const db = getDb();
    db.prepare(
        `INSERT INTO leash (guild_id, user_id, anti_mute, anti_unmute, notify_dm, set_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET
            anti_mute = excluded.anti_mute,
            anti_unmute = excluded.anti_unmute,
            notify_dm = excluded.notify_dm,
            set_by = excluded.set_by`
    ).run(guildId, userId, antiMute ? 1 : 0, antiUnmute ? 1 : 0, notifyDm ? 1 : 0, setBy, Date.now());
}

function get(guildId, userId) {
    const db = getDb();
    return db.prepare("SELECT * FROM leash WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
}

function remove(guildId, userId) {
    const db = getDb();
    const result = db.prepare("DELETE FROM leash WHERE guild_id = ? AND user_id = ?").run(guildId, userId);
    return Number(result.changes) > 0;
}

function listByGuild(guildId) {
    const db = getDb();
    return db.prepare("SELECT * FROM leash WHERE guild_id = ?").all(guildId);
}

function setNotifyDm(guildId, userId, notifyDm) {
    const db = getDb();
    db.prepare("UPDATE leash SET notify_dm = ? WHERE guild_id = ? AND user_id = ?").run(
        notifyDm ? 1 : 0,
        guildId,
        userId
    );
}

module.exports = { set, get, remove, listByGuild, setNotifyDm };
