-- CrowGESTION-exclusive: fixes the salon where moderation commands must be run.
CREATE TABLE IF NOT EXISTS mod_channel (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL
);
