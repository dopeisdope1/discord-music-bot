-- Identity-scoped: CrowALL logs to its own #mod-logs, CrowPROTECT to its own #protect-logs, etc.
CREATE TABLE IF NOT EXISTS log_channels (
    guild_id TEXT NOT NULL,
    identity_key TEXT NOT NULL,
    log_type TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    PRIMARY KEY (guild_id, identity_key, log_type)
);
