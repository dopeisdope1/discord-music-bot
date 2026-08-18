"use strict";

const { Events } = require("discord.js");
const logsConfigRepo = require("../db/repositories/logsConfigRepo");

module.exports = {
    name: Events.GuildRoleCreate,
    async execute(client, identity, role) {
        if (identity.key !== "crowall") return;
        await logsConfigRepo.postLog(client, identity, role.guild.id, "roles", {
            title: "🎭 Rôle créé",
            color: "#57F287",
            fields: [{ name: "Rôle", value: `${role.name} (${role.id})` }],
        });
    },
};
