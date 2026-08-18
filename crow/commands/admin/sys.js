"use strict";

const permissionRepo = require("../../db/repositories/permissionRepo");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");
const { listField } = require("../../utils/embeds");

module.exports = {
    name: "sys",
    category: "admin",
    description: "Gère les administrateurs système.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const sub = (ctx.args[0] || "").toLowerCase();

        if (sub !== "add" && sub !== "remove") {
            const ids = permissionRepo.listUsersAtLevel(ctx.guildId, LEVEL.MOD);
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "🛠️ Administrateurs système",
                        description: listField(
                            ids.map((id) => `<@${id}>`),
                            { empty: "Aucun administrateur système configuré sur ce serveur." }
                        ),
                    }),
                ],
            });
            return;
        }

        const targetId = extractUserId(ctx.args[1]);
        if (!targetId) throw new UsageError("sys <add|remove> @user");

        if (sub === "add") {
            permissionRepo.setUserLevel(ctx.guildId, targetId, LEVEL.MOD);
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "🛠️ Administrateur système ajouté",
                        description: `<@${targetId}> est désormais administrateur système.`,
                    }),
                ],
            });
        } else {
            permissionRepo.removeUserLevel(ctx.guildId, targetId);
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "🛠️ Administrateur système retiré",
                        description: `<@${targetId}> n'est plus administrateur système.`,
                    }),
                ],
            });
        }
    },
};
