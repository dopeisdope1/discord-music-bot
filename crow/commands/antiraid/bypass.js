"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const { UsageError } = require("../../core/errors");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");
const { extractUserId } = require("../../utils/args");

// Antiraid-wide bypass list (exempts a user from every guard's authorized-actor
// check). Distinct from CrowALL's admin-level `+wl` whitelist — do not merge.
module.exports = {
    name: "bypass",
    category: "antiraid",
    description: "Gère la liste blanche d'utilisateurs autorisés.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const sub = (ctx.args[0] || "list").toLowerCase();

        if (sub === "add" || sub === "remove") {
            const userId = extractUserId(ctx.args[1]);
            if (!userId) throw new UsageError(`bypass ${sub} @utilisateur`);

            if (sub === "add") {
                guardConfigRepo.addWhitelist(ctx.guildId, ctx.identity.key, "user", userId);
                await ctx.reply(`✅ <@${userId}> ajouté à la liste blanche antiraid.`);
            } else {
                guardConfigRepo.removeWhitelist(ctx.guildId, ctx.identity.key, "user", userId);
                await ctx.reply(`✅ <@${userId}> retiré de la liste blanche antiraid.`);
            }
            return;
        }

        if (sub === "list") {
            const entries = guardConfigRepo.listWhitelist(ctx.guildId, ctx.identity.key);
            if (entries.length === 0) {
                await ctx.reply("Aucune entrée dans la liste blanche antiraid.");
                return;
            }
            const lines = entries.map((e) =>
                e.entity_type === "user" ? `<@${e.entity_id}>` : `<@&${e.entity_id}>`
            );
            const embed = ctx.embed({ title: "🛡️ Liste blanche antiraid", description: lines.join("\n") });
            await ctx.reply({ embeds: [embed] });
            return;
        }

        throw new UsageError("bypass [add|remove] @utilisateur | bypass list");
    },
};
