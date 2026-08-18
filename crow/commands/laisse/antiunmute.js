"use strict";

const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

// See laisse/antimute.js for the full rationale — same pattern, other column.
module.exports = {
    name: "antiunmute",
    category: "laisse",
    description: "Active ou désactive la protection anti-unmute.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const choice = (ctx.args[0] || "").toLowerCase();
        if (choice !== "on" && choice !== "off") throw new UsageError("antiunmute <on|off>");

        const antiUnmute = choice === "on" ? 1 : 0;
        ctx.db
            .prepare(
                `INSERT INTO laisse_defaults (guild_id, anti_mute, anti_unmute) VALUES (?, 0, ?)
                 ON CONFLICT (guild_id) DO UPDATE SET anti_unmute = excluded.anti_unmute`
            )
            .run(ctx.guildId, antiUnmute);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🐕 Laisse — Anti-unmute",
                    description: `La protection anti-unmute par défaut est désormais **${
                        antiUnmute ? "activée" : "désactivée"
                    }**.\n⚠️ Ce réglage n'est pas rétroactif : il n'affecte pas les utilisateurs déjà en laisse, seulement un futur branchement de \`+laisse\` sur ce défaut.`,
                }),
            ],
        });
    },
};
