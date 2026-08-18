CREATE TABLE IF NOT EXISTS member_counters (
    channel_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    template TEXT NOT NULL
);
