"use strict";

const guildSettingsRepo = require("../../db/repositories/guildSettingsRepo");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "prefix",
    category: "admin",
    description: "Change le préfixe du bot.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const newPrefix = ctx.args[0];
        if (!newPrefix || newPrefix.length > 5 || /\s/.test(newPrefix)) {
            throw new UsageError("prefix <1-5 caractères, sans espace>");
        }

        guildSettingsRepo.setField(ctx.guildId, ctx.identity.key, "prefix", newPrefix);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "⚙️ Préfixe mis à jour",
                    description: `Le préfixe est désormais \`${newPrefix}\`.`,
                }),
            ],
        });
    },
};
