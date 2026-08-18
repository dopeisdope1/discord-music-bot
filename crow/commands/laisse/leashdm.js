"use strict";

const leashRepo = require("../../db/repositories/leashRepo");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");

// This is CrowLAISSE's original "+setdm" from the product spec, renamed to
// avoid colliding with CrowBL's "+setdm" (ban-DM template) inside the same
// crowgestion identity registry — see bl/setdm.js for the collision note.
//
// LIMITATION: Discord bots cannot literally block a user's DMs to OTHER
// users — there's no such API. This command only toggles whether the
// leashed user themself gets DM'd when their leash status changes; it does
// NOT intercept or block any of their outgoing DMs to other people.
module.exports = {
    name: "leashdm",
    category: "laisse",
    description: "Active/Désactive la notification DM lors d'une action de laisse.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("leashdm @user <on|off>");

        const choice = (ctx.args[1] || "").toLowerCase();
        if (choice !== "on" && choice !== "off") throw new UsageError("leashdm @user <on|off>");

        if (!leashRepo.get(ctx.guildId, targetId)) {
            throw new BotError("Cet utilisateur n'est pas en laisse.");
        }

        const notifyDm = choice === "on";
        leashRepo.setNotifyDm(ctx.guildId, targetId, notifyDm);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🐕 Laisse — Notification DM",
                    description: `La notification DM pour <@${targetId}> lors d'une action de laisse est désormais **${
                        notifyDm ? "activée" : "désactivée"
                    }**.`,
                }),
            ],
        });
    },
};
