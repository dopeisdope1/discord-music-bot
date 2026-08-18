"use strict";

const { Events } = require("discord.js");
const logsConfigRepo = require("../db/repositories/logsConfigRepo");

module.exports = {
    name: Events.InviteCreate,
    async execute(client, identity, invite) {
        if (identity.key !== "crowall" || !invite.guild) return;
        await logsConfigRepo.postLog(client, identity, invite.guild.id, "invites", {
            title: "🔗 Invitation créée",
            color: "#57F287",
            fields: [
                { name: "Code", value: invite.code },
                { name: "Créée par", value: invite.inviter ? `${invite.inviter.tag}` : "Inconnu" },
                { name: "Salon", value: `${invite.channel}` },
            ],
        });
    },
};
