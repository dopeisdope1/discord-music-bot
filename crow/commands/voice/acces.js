"use strict";

const voiceRepo = require("../../db/repositories/voiceRepo");
const { UsageError } = require("../../core/errors");
const { extractUserId } = require("../../utils/args");
const { requireOwnedVoiceChannel } = require("./_helpers");

module.exports = {
    name: "acces",
    category: "voice",
    description: "Donne ou retire l'accès à un salon privé.",
    permLevel: 0,
    aliases: [],
    async execute(ctx) {
        const sub = (ctx.args[0] || "").toLowerCase();
        if (sub !== "add" && sub !== "remove") throw new UsageError("acces <add|remove> @user");

        const targetId = extractUserId(ctx.args[1]);
        if (!targetId) throw new UsageError("acces <add|remove> @user");

        const { channel } = requireOwnedVoiceChannel(ctx);

        if (sub === "add") {
            await channel.permissionOverwrites.edit(targetId, { Connect: true, ViewChannel: true });
            voiceRepo.setAccess(channel.id, targetId, "allow");
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "✅ Accès accordé",
                        description: `<@${targetId}> peut désormais rejoindre ${channel}.`,
                    }),
                ],
            });
        } else {
            await channel.permissionOverwrites.edit(targetId, { Connect: false });
            voiceRepo.setAccess(channel.id, targetId, "deny");
            await ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "⛔ Accès retiré",
                        description: `<@${targetId}> ne peut plus rejoindre ${channel}.`,
                    }),
                ],
            });
        }
    },
};
