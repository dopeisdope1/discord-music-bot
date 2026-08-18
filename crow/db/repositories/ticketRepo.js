"use strict";

const { getDb } = require("../connection");

function getConfig(guildId) {
    const db = getDb();
    return db.prepare("SELECT * FROM ticket_config WHERE guild_id = ?").get(guildId);
}

function ensureConfig(guildId) {
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO ticket_config (guild_id) VALUES (?)").run(guildId);
}

function setConfigField(guildId, field, value) {
    const allowed = new Set(["category_id", "staff_role_id", "panel_channel_id"]);
    if (!allowed.has(field)) throw new Error(`ticketRepo.setConfigField: unknown field "${field}"`);

    ensureConfig(guildId);
    const db = getDb();
    db.prepare(`UPDATE ticket_config SET ${field} = ? WHERE guild_id = ?`).run(value, guildId);
}

function nextTicketNumber(guildId) {
    ensureConfig(guildId);
    const db = getDb();
    const row = db.prepare("SELECT next_number FROM ticket_config WHERE guild_id = ?").get(guildId);
    db.prepare("UPDATE ticket_config SET next_number = next_number + 1 WHERE guild_id = ?").run(guildId);
    return row.next_number;
}

function create({ guildId, channelId, openerId }) {
    const db = getDb();
    const result = db
        .prepare(
            "INSERT INTO tickets (guild_id, channel_id, opener_id, status, created_at) VALUES (?, ?, ?, 'open', ?)"
        )
        .run(guildId, channelId, openerId, Date.now());
    return Number(result.lastInsertRowid);
}

function getByChannel(channelId) {
    const db = getDb();
    return db.prepare("SELECT * FROM tickets WHERE channel_id = ?").get(channelId);
}

function claim(id, staffId) {
    const db = getDb();
    db.prepare("UPDATE tickets SET status = 'claimed', claimed_by = ? WHERE id = ?").run(staffId, id);
}

function close(id, transcript) {
    const db = getDb();
    db.prepare(
        "UPDATE tickets SET status = 'closed', closed_at = ?, transcript = ? WHERE id = ?"
    ).run(Date.now(), transcript || null, id);
}

function listOpen(guildId) {
    const db = getDb();
    return db
        .prepare("SELECT * FROM tickets WHERE guild_id = ? AND status != 'closed' ORDER BY created_at DESC")
        .all(guildId);
}

function stats(guildId) {
    const db = getDb();
    const total = db.prepare("SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ?").get(guildId).n;
    const open = db
        .prepare("SELECT COUNT(*) AS n FROM tickets WHERE guild_id = ? AND status != 'closed'")
        .get(guildId).n;
    const closed = total - open;
    return { total, open, closed };
}

module.exports = {
    getConfig,
    ensureConfig,
    setConfigField,
    nextTicketNumber,
    create,
    getByChannel,
    claim,
    close,
    listOpen,
    stats,
};
