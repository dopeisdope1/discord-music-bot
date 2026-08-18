"use strict";

const leashRepo = require("../../db/repositories/leashRepo");
const logsConfigRepo = require("../../db/repositories/logsConfigRepo");
const { UsageError, BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");

module.exports = {
    name: "laisse",
    category: "laisse",
    description: "Met ou retire un utilisateur en laisse.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("laisse @user");

        if (leashRepo.get(ctx.guildId, targetId)) {
            leashRepo.remove(ctx.guildId, targetId);
            await logsConfigRepo.postLog(ctx.client, ctx.identity, ctx.guildId, "laisse", {
                title: "🐕 Laisse retirée",
                color: "#57F287",
                fields: [{ name: "Membre", value: `<@${targetId}> (${targetId})` }, { name: "Par", value: `${ctx.author}` }],
            });
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "🐕 Laisse",
                        description: `<@${targetId}> n'est plus en laisse.`,
                    }),
                ],
            });
            return;
        }

        leashRepo.set(ctx.guildId, targetId, {
            antiMute: false,
            antiUnmute: false,
            notifyDm: false,
            setBy: ctx.author.id,
        });

        await logsConfigRepo.postLog(ctx.client, ctx.identity, ctx.guildId, "laisse", {
            title: "🐕 Laisse posée",
            color: "#ED4245",
            fields: [{ name: "Membre", value: `<@${targetId}> (${targetId})` }, { name: "Par", value: `${ctx.author}` }],
        });

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "🐕 Laisse",
                    description: `<@${targetId}> est désormais en laisse. Utilise \`antimute\`/\`antiunmute\` pour configurer les restrictions.`,
                }),
            ],
        });
    },
};
