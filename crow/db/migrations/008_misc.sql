CREATE TABLE IF NOT EXISTS afk (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reason TEXT,
    since INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    guild_id TEXT,
    channel_id TEXT NOT NULL,
    remind_at INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    delivered INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_reminders_pending ON reminders (delivered, remind_at);

-- FiveM status has no auth requirement — just needs to know which host:port to poll per guild.
CREATE TABLE IF NOT EXISTS fivem_servers (
    guild_id TEXT PRIMARY KEY,
    host TEXT NOT NULL,
    port INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS leash (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    anti_mute INTEGER NOT NULL DEFAULT 0,
    anti_unmute INTEGER NOT NULL DEFAULT 0,
    notify_dm INTEGER NOT NULL DEFAULT 0,
    set_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS role_limit_config (
    guild_id TEXT NOT NULL,
    identity_key TEXT NOT NULL,
    role_id TEXT NOT NULL,
    max_per_window INTEGER NOT NULL DEFAULT 5,
    window_ms INTEGER NOT NULL DEFAULT 10000,
    PRIMARY KEY (guild_id, identity_key, role_id)
);
