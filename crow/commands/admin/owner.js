"use strict";

const permissionRepo = require("../../db/repositories/permissionRepo");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");
const { listField } = require("../../utils/embeds");

module.exports = {
    name: "owner",
    category: "admin",
    description: "Gère les owners du bot.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const sub = (ctx.args[0] || "").toLowerCase();

        if (sub !== "add" && sub !== "remove") {
            const ids = permissionRepo.listUsersAtLevel(ctx.guildId, LEVEL.ADMIN);
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "👑 Owners",
                        description: listField(
                            ids.map((id) => `<@${id}>`),
                            { empty: "Aucun owner configuré sur ce serveur." }
                        ),
                    }),
                ],
            });
            return;
        }

        const targetId = extractUserId(ctx.args[1]);
        if (!targetId) throw new UsageError("owner <add|remove> @user");

        if (sub === "add") {
            permissionRepo.setUserLevel(ctx.guildId, targetId, LEVEL.ADMIN);
            await ctx.reply({
                embeds: [
                    ctx.embed({ title: "👑 Owner ajouté", description: `<@${targetId}> est désormais owner.` }),
                ],
            });
        } else {
            permissionRepo.removeUserLevel(ctx.guildId, targetId);
            await ctx.reply({
                embeds: [
                    ctx.embed({ title: "👑 Owner retiré", description: `<@${targetId}> n'est plus owner.` }),
                ],
            });
        }
    },
};
