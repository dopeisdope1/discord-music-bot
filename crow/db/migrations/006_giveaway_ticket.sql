CREATE TABLE IF NOT EXISTS giveaways (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    prize TEXT NOT NULL,
    winners_count INTEGER NOT NULL DEFAULT 1,
    ends_at INTEGER NOT NULL,
    host_id TEXT NOT NULL,
    ended INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_giveaways_active ON giveaways (ended, ends_at);

CREATE TABLE IF NOT EXISTS giveaway_entries (
    giveaway_id INTEGER NOT NULL,
    user_id TEXT NOT NULL,
    entered_at INTEGER NOT NULL,
    PRIMARY KEY (giveaway_id, user_id)
);

CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    opener_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'claimed', 'closed')),
    claimed_by TEXT,
    created_at INTEGER NOT NULL,
    closed_at INTEGER,
    transcript TEXT
);

CREATE TABLE IF NOT EXISTS ticket_config (
    guild_id TEXT PRIMARY KEY,
    category_id TEXT,
    staff_role_id TEXT,
    panel_channel_id TEXT,
    next_number INTEGER NOT NULL DEFAULT 1
);
