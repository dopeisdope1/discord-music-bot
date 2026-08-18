"use strict";

const { Events } = require("discord.js");
const logsConfigRepo = require("../db/repositories/logsConfigRepo");

module.exports = {
    name: Events.InviteDelete,
    async execute(client, identity, invite) {
        if (identity.key !== "crowall" || !invite.guild) return;
        await logsConfigRepo.postLog(client, identity, invite.guild.id, "invites", {
            title: "🔗 Invitation supprimée",
            color: "#ED4245",
            fields: [{ name: "Code", value: invite.code }],
        });
    },
};
