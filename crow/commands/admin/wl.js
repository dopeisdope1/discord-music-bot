"use strict";

const permissionRepo = require("../../db/repositories/permissionRepo");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");
const { listField } = require("../../utils/embeds");

// CrowALL's own admin-level whitelist — a convenience alias that grants Staff
// tier. Distinct from the antiraid "bypass" command and from voice's "wl".
module.exports = {
    name: "wl",
    category: "admin",
    description: "Gère la liste blanche d'administration.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const sub = (ctx.args[0] || "").toLowerCase();

        if (sub !== "add" && sub !== "remove") {
            const ids = permissionRepo.listUsersAtLevel(ctx.guildId, LEVEL.STAFF);
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "📋 Liste blanche",
                        description: listField(
                            ids.map((id) => `<@${id}>`),
                            { empty: "Aucun membre en liste blanche sur ce serveur." }
                        ),
                    }),
                ],
            });
            return;
        }

        const targetId = extractUserId(ctx.args[1]);
        if (!targetId) throw new UsageError("wl <add|remove> @user");

        if (sub === "add") {
            permissionRepo.setUserLevel(ctx.guildId, targetId, LEVEL.STAFF);
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "📋 Ajouté à la liste blanche",
                        description: `<@${targetId}> a désormais le rang Staff.`,
                    }),
                ],
            });
        } else {
            permissionRepo.removeUserLevel(ctx.guildId, targetId);
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "📋 Retiré de la liste blanche",
                        description: `<@${targetId}> n'est plus en liste blanche.`,
                    }),
                ],
            });
        }
    },
};
