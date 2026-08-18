"use strict";

const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

// Guild-wide DEFAULT for the anti-mute flag applied to *future* `+laisse`
// uses — there is no dedicated column for this on `leash` (which is
// per-user), so it's stored in its own tiny table (see migrations/009_laisse_defaults.sql).
// NOTE: this does NOT retroactively update users already in `leash` — only
// this toggle itself is persisted here. Wiring `+laisse` to actually read
// this default when creating a new leash row is left as future work, kept
// out of this change to stay small.
module.exports = {
    name: "antimute",
    category: "laisse",
    description: "Active ou désactive la protection anti-mute.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const choice = (ctx.args[0] || "").toLowerCase();
        if (choice !== "on" && choice !== "off") throw new UsageError("antimute <on|off>");

        const antiMute = choice === "on" ? 1 : 0;
        ctx.db
            .prepare(
                `INSERT INTO laisse_defaults (guild_id, anti_mute, anti_unmute) VALUES (?, ?, 0)
                 ON CONFLICT (guild_id) DO UPDATE SET anti_mute = excluded.anti_mute`
            )
            .run(ctx.guildId, antiMute);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🐕 Laisse — Anti-mute",
                    description: `La protection anti-mute par défaut est désormais **${
                        antiMute ? "activée" : "désactivée"
                    }**.\n⚠️ Ce réglage n'est pas rétroactif : il n'affecte pas les utilisateurs déjà en laisse, seulement un futur branchement de \`+laisse\` sur ce défaut.`,
                }),
            ],
        });
    },
};
