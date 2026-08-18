"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");

const GUARD_KEYS = [
    "antirole",
    "antiban",
    "antibot",
    "antichannel",
    "antideco",
    "antieveryone",
    "antiwebhook",
    "antijoin",
    "antikick",
    "antilink",
    "antiupdate",
];

module.exports = {
    name: "antiraid",
    category: "antiraid",
    description: "Active ou désactive la suite antiraid.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const arg = (ctx.args[0] || "").toLowerCase();
        let targetState;

        if (arg === "on" || arg === "off") {
            targetState = arg === "on";
        } else {
            const enabledCount = GUARD_KEYS.filter(
                (key) => guardConfigRepo.getConfig(ctx.guildId, ctx.identity.key, key)?.enabled
            ).length;
            // Majority currently off -> turn everything on, majority on -> turn everything off.
            targetState = enabledCount < GUARD_KEYS.length / 2;
        }

        for (const key of GUARD_KEYS) {
            guardConfigRepo.setEnabled(ctx.guildId, ctx.identity.key, key, targetState);
        }

        const embed = ctx.embed({
            title: "🛡️ Suite antiraid",
            description: targetState
                ? `✅ Toutes les gardes antiraid (${GUARD_KEYS.length}) ont été **activées**.`
                : `❌ Toutes les gardes antiraid (${GUARD_KEYS.length}) ont été **désactivées**.`,
        });
        await ctx.reply({ embeds: [embed] });
    },
};
