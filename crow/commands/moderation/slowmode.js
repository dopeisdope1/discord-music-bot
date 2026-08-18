"use strict";

const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

const MAX_SLOWMODE_SECONDS = 21600;

module.exports = {
    name: "slowmode",
    category: "moderation",
    description: "Configure le mode lent dans le salon.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const n = Number(ctx.args[0]);
        if (!Number.isInteger(n) || n < 0 || n > MAX_SLOWMODE_SECONDS) {
            throw new UsageError("slowmode [secondes] (0-21600)");
        }

        await ctx.message.channel.setRateLimitPerUser(n);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🐌 Mode lent",
                    description:
                        n === 0
                            ? "Le mode lent a été désactivé sur ce salon."
                            : `Le mode lent a été réglé sur ${n} seconde(s) sur ce salon.`,
                }),
            ],
        });
    },
};
