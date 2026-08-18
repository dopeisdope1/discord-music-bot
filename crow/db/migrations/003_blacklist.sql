-- CrowALL's +bl/+unbl/+blinfo: informational per-guild list, no auto-ban side effect.
CREATE TABLE IF NOT EXISTS guild_blacklist (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reason TEXT,
    added_by TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);

-- CrowBL: cross-guild network list, enforced with auto-ban-on-join.
CREATE TABLE IF NOT EXISTS global_blacklist (
    user_id TEXT PRIMARY KEY,
    reason TEXT,
    added_by TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    scope TEXT NOT NULL DEFAULT 'network'
);

-- CrowBLR: users blocked from holding "special" roles.
CREATE TABLE IF NOT EXISTS role_blacklist (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    added_by TEXT NOT NULL,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS blacklist_dm_template (
    guild_id TEXT PRIMARY KEY,
    message TEXT NOT NULL
);
