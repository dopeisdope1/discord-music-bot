"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const { UsageError } = require("../../core/errors");
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
const VALID_PUNITIONS = ["kick", "ban", "mute"];

module.exports = {
    name: "punition",
    category: "antiraid",
    description: "Configure la sanction par défaut (kick/ban/mute).",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const value = (ctx.args[0] || "").toLowerCase();
        if (!VALID_PUNITIONS.includes(value)) {
            throw new UsageError(`punition <${VALID_PUNITIONS.join("|")}>`);
        }

        for (const key of GUARD_KEYS) {
            guardConfigRepo.setPunition(ctx.guildId, ctx.identity.key, key, value);
        }

        await ctx.reply(`✅ Sanction par défaut définie sur **${value}** pour toutes les gardes antiraid.`);
    },
};
