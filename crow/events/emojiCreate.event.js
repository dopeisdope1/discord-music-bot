"use strict";

const { Events } = require("discord.js");
const logsConfigRepo = require("../db/repositories/logsConfigRepo");

module.exports = {
    name: Events.GuildEmojiCreate,
    async execute(client, identity, emoji) {
        if (identity.key !== "crowall") return;
        await logsConfigRepo.postLog(client, identity, emoji.guild.id, "emojis", {
            title: "😀 Emoji ajouté",
            color: "#57F287",
            fields: [{ name: "Nom", value: `:${emoji.name}:` }],
        });
    },
};
