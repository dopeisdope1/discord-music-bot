"use strict";

const { Events } = require("discord.js");
const logsConfigRepo = require("../db/repositories/logsConfigRepo");

module.exports = {
    name: Events.GuildUpdate,
    async execute(client, identity, oldGuild, newGuild) {
        if (identity.key !== "crowall") return;

        const changes = [];
        if (oldGuild.name !== newGuild.name) changes.push({ name: "Nom", value: `${oldGuild.name} → ${newGuild.name}` });
        if (oldGuild.iconURL() !== newGuild.iconURL()) changes.push({ name: "Icône", value: "Modifiée" });
        if (oldGuild.ownerId !== newGuild.ownerId) {
            changes.push({ name: "Propriétaire", value: `<@${oldGuild.ownerId}> → <@${newGuild.ownerId}>` });
        }
        if (changes.length === 0) return;

        await logsConfigRepo.postLog(client, identity, newGuild.id, "server", {
            title: "⚙️ Paramètres du serveur modifiés",
            color: "#5865F2",
            fields: changes,
        });
    },
};
