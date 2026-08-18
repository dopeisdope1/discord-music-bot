"use strict";

const { Events } = require("discord.js");
const logsConfigRepo = require("../db/repositories/logsConfigRepo");

module.exports = {
    name: Events.ChannelUpdate,
    async execute(client, identity, oldChannel, newChannel) {
        if (identity.key !== "crowall" || !newChannel.guild) return;
        if (oldChannel.name === newChannel.name) return; // avoid noise on every minor internal update
        await logsConfigRepo.postLog(client, identity, newChannel.guild.id, "channels", {
            title: "✏️ Salon renommé",
            color: "#FEE75C",
            fields: [{ name: "Avant", value: oldChannel.name }, { name: "Après", value: newChannel.name }],
        });
    },
};
