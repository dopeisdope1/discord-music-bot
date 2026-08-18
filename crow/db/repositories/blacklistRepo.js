"use strict";

const { getDb } = require("../connection");

// --- guild_blacklist: CrowALL's informational per-guild list, no auto-ban side effect ---

function guildAdd(guildId, userId, reason, addedBy) {
    const db = getDb();
    db.prepare(
        `INSERT INTO guild_blacklist (guild_id, user_id, reason, added_by, added_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (guild_id, user_id) DO UPDATE SET reason = excluded.reason, added_by = excluded.added_by, added_at = excluded.added_at`
    ).run(guildId, userId, reason || null, addedBy, Date.now());
}

function guildRemove(guildId, userId) {
    const db = getDb();
    const result = db
        .prepare("DELETE FROM guild_blacklist WHERE guild_id = ? AND user_id = ?")
        .run(guildId, userId);
    return Number(result.changes) > 0;
}

function guildGet(guildId, userId) {
    const db = getDb();
    return db.prepare("SELECT * FROM guild_blacklist WHERE guild_id = ? AND user_id = ?").get(guildId, userId);
}

function guildList(guildId) {
    const db = getDb();
    return db.prepare("SELECT * FROM guild_blacklist WHERE guild_id = ?").all(guildId);
}

// --- global_blacklist: CrowBL's cross-guild network list, enforced with auto-ban-on-join ---

function globalAdd(userId, reason, addedBy, scope = "network") {
    const db = getDb();
    db.prepare(
        `INSERT INTO global_blacklist (user_id, reason, added_by, added_at, scope) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id) DO UPDATE SET reason = excluded.reason, added_by = excluded.added_by, added_at = excluded.added_at, scope = excluded.scope`
    ).run(userId, reason || null, addedBy, Date.now(), scope);
}

function globalRemove(userId) {
    const db = getDb();
    const result = db.prepare("DELETE FROM global_blacklist WHERE user_id = ?").run(userId);
    return Number(result.changes) > 0;
}

function globalGet(userId) {
    const db = getDb();
    return db.prepare("SELECT * FROM global_blacklist WHERE user_id = ?").get(userId);
}

function globalIsBlacklisted(userId) {
    return Boolean(globalGet(userId));
}

// --- role_blacklist: CrowBLR's users blocked from holding "special" roles ---

function roleBlacklistAdd(guildId, userId, addedBy) {
    const db = getDb();
    db.prepare(
        `INSERT INTO role_blacklist (guild_id, user_id, added_by, added_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (guild_id, user_id) DO NOTHING`
    ).run(guildId, userId, addedBy, Date.now());
}

function roleBlacklistRemove(guildId, userId) {
    const db = getDb();
    const result = db
        .prepare("DELETE FROM role_blacklist WHERE guild_id = ? AND user_id = ?")
        .run(guildId, userId);
    return Number(result.changes) > 0;
}

function roleBlacklistIs(guildId, userId) {
    const db = getDb();
    return Boolean(
        db.prepare("SELECT 1 FROM role_blacklist WHERE guild_id = ? AND user_id = ?").get(guildId, userId)
    );
}

function roleBlacklistToggle(guildId, userId, addedBy) {
    if (roleBlacklistIs(guildId, userId)) {
        roleBlacklistRemove(guildId, userId);
        return false;
    }
    roleBlacklistAdd(guildId, userId, addedBy);
    return true;
}

// --- special roles watched by CrowBLR ---

function specialRoleAdd(guildId, identityKey, roleId) {
    const guardConfigRepo = require("./guardConfigRepo");
    guardConfigRepo.addWatchedRole(guildId, identityKey, "roleBlacklist", roleId);
}

function specialRoleRemove(guildId, identityKey, roleId) {
    const guardConfigRepo = require("./guardConfigRepo");
    guardConfigRepo.removeWatchedRole(guildId, identityKey, "roleBlacklist", roleId);
}

function specialRoleList(guildId, identityKey) {
    const guardConfigRepo = require("./guardConfigRepo");
    return guardConfigRepo.listWatchedRoles(guildId, identityKey, "roleBlacklist");
}

// --- CrowBL's ban-DM message template ---

function setDmTemplate(guildId, message) {
    const db = getDb();
    db.prepare(
        `INSERT INTO blacklist_dm_template (guild_id, message) VALUES (?, ?)
         ON CONFLICT (guild_id) DO UPDATE SET message = excluded.message`
    ).run(guildId, message);
}

function getDmTemplate(guildId) {
    const db = getDb();
    return db.prepare("SELECT message FROM blacklist_dm_template WHERE guild_id = ?").get(guildId)?.message;
}

module.exports = {
    guildAdd,
    guildRemove,
    guildGet,
    guildList,
    globalAdd,
    globalRemove,
    globalGet,
    globalIsBlacklisted,
    roleBlacklistAdd,
    roleBlacklistRemove,
    roleBlacklistIs,
    roleBlacklistToggle,
    specialRoleAdd,
    specialRoleRemove,
    specialRoleList,
    setDmTemplate,
    getDmTemplate,
};
