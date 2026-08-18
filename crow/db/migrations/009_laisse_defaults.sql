-- CrowLAISSE: guild-wide default toggles for future `+laisse` uses (antimute/antiunmute).
-- Not retroactively applied to already-leashed users — see laisse/antimute.js and
-- laisse/antiunmute.js for details.
CREATE TABLE IF NOT EXISTS laisse_defaults (
    guild_id TEXT PRIMARY KEY,
    anti_mute INTEGER NOT NULL DEFAULT 0,
    anti_unmute INTEGER NOT NULL DEFAULT 0
);
