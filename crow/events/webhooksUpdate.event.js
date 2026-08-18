"use strict";

const { Events } = require("discord.js");
const logsConfigRepo = require("../db/repositories/logsConfigRepo");

// General factual record — distinct from the antiwebhook guard's own internal
// listener on the same event, which only logs UNAUTHORIZED changes.
module.exports = {
    name: Events.WebhooksUpdate,
    async execute(client, identity, channel) {
        if (identity.key !== "crowall") return;
        await logsConfigRepo.postLog(client, identity, channel.guild.id, "webhooks", {
            title: "🪝 Webhook modifié",
            color: "#5865F2",
            fields: [{ name: "Salon", value: `${channel}` }],
        });
    },
};
