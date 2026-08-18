"use strict";

const { Events } = require("discord.js");
const logsConfigRepo = require("../db/repositories/logsConfigRepo");

module.exports = {
    name: Events.ChannelCreate,
    async execute(client, identity, channel) {
        if (identity.key !== "crowall" || !channel.guild) return;
        await logsConfigRepo.postLog(client, identity, channel.guild.id, "channels", {
            title: "➕ Salon créé",
            color: "#57F287",
            fields: [
                { name: "Salon", value: `${channel.name} (${channel.id})` },
                { name: "Type", value: String(channel.type) },
            ],
        });
    },
};
