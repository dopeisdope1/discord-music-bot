-- Guild-scoped ONLY: shared moderation ledger across every Crow bot in a guild,
-- so running CrowALL + CrowGESTION together never fragments sanction history.
CREATE TABLE IF NOT EXISTS sanctions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('warn', 'mute', 'tempmute', 'kick', 'ban', 'tempban', 'derank')),
    reason TEXT,
    moderator_id TEXT NOT NULL,
    issued_by_identity TEXT NOT NULL,
    duration_ms INTEGER,
    expires_at INTEGER,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sanctions_guild_target ON sanctions (guild_id, target_id);
CREATE INDEX IF NOT EXISTS idx_sanctions_expiry ON sanctions (active, expires_at);

CREATE TABLE IF NOT EXISTS custom_commands (
    guild_id TEXT NOT NULL,
    name TEXT NOT NULL,
    response TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (guild_id, name)
);

CREATE TABLE IF NOT EXISTS badwords (
    guild_id TEXT NOT NULL,
    word TEXT NOT NULL,
    added_by TEXT,
    added_at INTEGER,
    PRIMARY KEY (guild_id, word)
);

CREATE TABLE IF NOT EXISTS mute_roles (
    guild_id TEXT PRIMARY KEY,
    role_id TEXT NOT NULL
);
