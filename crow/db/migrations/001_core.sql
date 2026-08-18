CREATE TABLE IF NOT EXISTS guilds (
    guild_id TEXT PRIMARY KEY,
    first_seen_at INTEGER NOT NULL
);

-- Identity-scoped: a guild running two Crow bots gets independent settings per bot.
CREATE TABLE IF NOT EXISTS guild_bot_settings (
    guild_id TEXT NOT NULL,
    identity_key TEXT NOT NULL,
    prefix TEXT,
    theme_color TEXT,
    lang TEXT NOT NULL DEFAULT 'fr',
    logs_master_enabled INTEGER NOT NULL DEFAULT 1,
    automod_enabled INTEGER NOT NULL DEFAULT 0,
    join_message TEXT,
    join_channel_id TEXT,
    leave_message TEXT,
    leave_channel_id TEXT,
    PRIMARY KEY (guild_id, identity_key)
);

-- Guild-scoped: shared 3-tier permission system, same table backs every identity's
-- +owner/+sys/+perm/+setperm/+wl/+gestion style commands.
CREATE TABLE IF NOT EXISTS permission_roles (
    guild_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    level INTEGER NOT NULL CHECK (level IN (1, 2, 3)),
    PRIMARY KEY (guild_id, role_id)
);

CREATE TABLE IF NOT EXISTS permission_users (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    level INTEGER NOT NULL CHECK (level IN (1, 2, 3)),
    PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS restrictions (
    guild_id TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('role', 'channel')),
    entity_id TEXT NOT NULL,
    command_name TEXT NOT NULL,
    PRIMARY KEY (guild_id, entity_type, entity_id, command_name)
);
