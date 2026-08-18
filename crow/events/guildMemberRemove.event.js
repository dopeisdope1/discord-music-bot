"use strict";

const { Events } = require("discord.js");
const guildSettingsRepo = require("../db/repositories/guildSettingsRepo");
const logsConfigRepo = require("../db/repositories/logsConfigRepo");

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(client, identity, member) {
        if (identity.key === "crowall") {
            await logsConfigRepo.postLog(client, identity, member.guild.id, "leave", {
                title: "🚪 Départ d'un membre",
                color: "#ED4245",
                fields: [
                    { name: "Utilisateur", value: `${member.user?.tag ?? member.id} (${member.id})` },
                    {
                        name: "Rôles",
                        value: member.roles?.cache?.size
                            ? [...member.roles.cache.values()].filter((r) => r.id !== member.guild.id).map((r) => r.name).join(", ") || "Aucun"
                            : "Inconnu",
                    },
                ],
            });
        }

        const settings = guildSettingsRepo.getSettings(member.guild.id, identity.key);
        if (!settings?.leave_channel_id || !settings?.leave_message) return;

        const channel = await member.guild.channels.fetch(settings.leave_channel_id).catch(() => null);
        if (!channel?.isTextBased?.()) return;

        const text = settings.leave_message
            .replaceAll("{user}", member.user?.tag ?? "Membre")
            .replaceAll("{server}", member.guild.name)
            .replaceAll("{count}", String(member.guild.memberCount));

        await channel.send(text).catch(() => {});
    },
};
