"use strict";

const { Events } = require("discord.js");
const logsConfigRepo = require("../db/repositories/logsConfigRepo");

module.exports = {
    name: Events.GuildRoleDelete,
    async execute(client, identity, role) {
        if (identity.key !== "crowall") return;
        await logsConfigRepo.postLog(client, identity, role.guild.id, "roles", {
            title: "🎭 Rôle supprimé",
            color: "#ED4245",
            fields: [{ name: "Rôle", value: `${role.name} (${role.id})` }],
        });
    },
};
