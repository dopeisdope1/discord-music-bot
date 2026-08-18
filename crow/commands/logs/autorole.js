"use strict";

const guildSettingsRepo = require("../../db/repositories/guildSettingsRepo");
const { extractRoleId } = require("../../utils/args");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "autorole",
    category: "logs",
    description: "Configure le rôle attribué automatiquement aux nouveaux membres.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        if (ctx.args.length === 0) {
            return ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "🎫 Rôle automatique",
                        description: ctx.settings?.auto_role_id
                            ? `Actuellement : <@&${ctx.settings.auto_role_id}>`
                            : "Non configuré.",
                        footer: "autorole @role | autorole off",
                    }),
                ],
            });
        }

        if (ctx.args[0].toLowerCase() === "off") {
            guildSettingsRepo.setField(ctx.guildId, ctx.identity.key, "auto_role_id", null);
            return ctx.reply("❌ Rôle automatique désactivé.");
        }

        const roleId = extractRoleId(ctx.args[0]);
        if (!roleId) throw new UsageError("autorole @role | autorole off");

        guildSettingsRepo.setField(ctx.guildId, ctx.identity.key, "auto_role_id", roleId);
        await ctx.reply(`✅ Les nouveaux membres recevront désormais <@&${roleId}> automatiquement.`);
    },
};
