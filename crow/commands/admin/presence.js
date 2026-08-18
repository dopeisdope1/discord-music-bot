"use strict";

const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

const VALID_STATUSES = new Set(["online", "idle", "dnd", "invisible"]);

// Satellite-only unified version of online/idle/dnd/invisible.js — CrowALL
// keeps the 4 separate commands instead (see admin:presence in disabledCommands).
module.exports = {
    name: "presence",
    category: "admin",
    description: "Change le statut de présence.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const status = (ctx.args[0] || "").toLowerCase();
        if (!VALID_STATUSES.has(status)) throw new UsageError("presence <online|idle|dnd|invisible>");

        try {
            ctx.client.user.setStatus(status);
        } catch {
            throw new BotError("Impossible de changer le statut du bot.");
        }

        await ctx.reply({
            embeds: [ctx.embed({ title: "🔄 Statut", description: `Statut défini sur **${status}**.` })],
        });
    },
};
