"use strict";

const voiceRepo = require("../../db/repositories/voiceRepo");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");
const { listField } = require("../../utils/embeds");

// CrowMASTER's voice-specific whitelist (bypasses temp-voice restrictions).
// Distinct from CrowALL's admin-level `+wl` in src/commands/admin/wl.js —
// different folder/category/table, never loaded into the same identity.
module.exports = {
    name: "vwl",
    category: "voice",
    description: "Gère la liste blanche vocale.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const sub = (ctx.args[0] || "").toLowerCase();

        if (sub === "list" || !sub) {
            const ids = voiceRepo.whitelistList(ctx.guildId);
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "📋 Liste blanche vocale",
                        description: listField(
                            ids.map((id) => `<@${id}>`),
                            { empty: "Aucun membre en liste blanche vocale." }
                        ),
                    }),
                ],
            });
            return;
        }

        if (sub !== "add" && sub !== "remove") throw new UsageError("vwl <add|remove|list> [@user]");

        const targetId = extractUserId(ctx.args[1]);
        if (!targetId) throw new UsageError("vwl <add|remove> @user");

        if (sub === "add") {
            voiceRepo.whitelistAdd(ctx.guildId, targetId);
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "📋 Ajouté à la liste blanche vocale",
                        description: `<@${targetId}> est désormais en liste blanche vocale.`,
                    }),
                ],
            });
        } else {
            voiceRepo.whitelistRemove(ctx.guildId, targetId);
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "📋 Retiré de la liste blanche vocale",
                        description: `<@${targetId}> n'est plus en liste blanche vocale.`,
                    }),
                ],
            });
        }
    },
};
