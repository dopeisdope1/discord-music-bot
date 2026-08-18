CREATE TABLE IF NOT EXISTS voice_config (
    guild_id TEXT PRIMARY KEY,
    hub_channel_id TEXT,
    category_id TEXT,
    move_channel_id TEXT,
    stats_channel_id TEXT,
    greet_channel_id TEXT,
    deco_mode INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS voice_channels (
    channel_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,
    is_temp INTEGER NOT NULL DEFAULT 1,
    locked INTEGER NOT NULL DEFAULT 0,
    user_limit INTEGER,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS voice_access (
    channel_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('allow', 'deny')),
    PRIMARY KEY (channel_id, user_id)
);

-- Guild-wide voice privilege ban (+blv/+unblv/+resetblv operate at this scope).
CREATE TABLE IF NOT EXISTS voice_bans (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    banned_by TEXT NOT NULL,
    banned_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS voice_whitelist (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);
