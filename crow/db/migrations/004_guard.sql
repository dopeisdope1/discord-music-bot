-- Identity-scoped: independent guard configuration per bot, even in the same guild.
CREATE TABLE IF NOT EXISTS guard_config (
    guild_id TEXT NOT NULL,
    identity_key TEXT NOT NULL,
    guard_key TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    punition TEXT NOT NULL DEFAULT 'kick' CHECK (punition IN ('kick', 'ban', 'mute')),
    settings_json TEXT,
    PRIMARY KEY (guild_id, identity_key, guard_key)
);

CREATE TABLE IF NOT EXISTS guard_watched_roles (
    guild_id TEXT NOT NULL,
    identity_key TEXT NOT NULL,
    guard_key TEXT NOT NULL,
    role_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, identity_key, guard_key, role_id)
);

CREATE TABLE IF NOT EXISTS guard_whitelist (
    guild_id TEXT NOT NULL,
    identity_key TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('user', 'role')),
    entity_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, identity_key, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS captcha_pending (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    code TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS raid_ping_role (
    guild_id TEXT NOT NULL,
    identity_key TEXT NOT NULL,
    role_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, identity_key)
);

CREATE TABLE IF NOT EXISTS account_age_requirement (
    guild_id TEXT PRIMARY KEY,
    min_age_ms INTEGER NOT NULL
);
