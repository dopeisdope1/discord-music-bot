-- src/commands/owner/backup.js: JSON-snapshot server backups (best-effort restore).
CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- src/commands/owner/soutien.js: config-only for now, see that file's header comment
-- for why live custom-status detection isn't wired (no GuildPresences intent).
CREATE TABLE IF NOT EXISTS soutien_config (
    guild_id TEXT PRIMARY KEY,
    role_id TEXT NOT NULL,
    keyword TEXT
);
