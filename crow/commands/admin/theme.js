"use strict";

const { setThemeColor } = require("../../services/themeService");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

const HEX_RE = /^#?[0-9a-f]{6}$/i;

module.exports = {
    name: "theme",
    category: "admin",
    description: "Modifie la couleur des embeds.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const input = ctx.args[0];
        if (!input || !HEX_RE.test(input)) throw new UsageError("theme #RRGGBB");

        const color = input.startsWith("#") ? input : `#${input}`;
        setThemeColor(ctx.guildId, ctx.identity.key, color);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🎨 Thème mis à jour",
                    description: `La couleur des embeds est désormais ${color}.`,
                    color,
                }),
            ],
        });
    },
};
