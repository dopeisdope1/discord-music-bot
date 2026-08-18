"use strict";

const { PermissionError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "leave",
    category: "admin",
    description: "Force le bot à quitter le serveur.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        if (!ctx.botOwner) throw new PermissionError("Réservé aux propriétaires du bot.");

        await ctx.reply("👋 Je quitte ce serveur.");
        await ctx.guild.leave();
    },
};
