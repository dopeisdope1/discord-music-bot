"use strict";

const { Events } = require("discord.js");
const logsConfigRepo = require("../db/repositories/logsConfigRepo");

module.exports = {
    name: Events.GuildStickerCreate,
    async execute(client, identity, sticker) {
        if (identity.key !== "crowall") return;
        await logsConfigRepo.postLog(client, identity, sticker.guild.id, "emojis", {
            title: "🏷️ Sticker ajouté",
            color: "#57F287",
            fields: [{ name: "Nom", value: sticker.name }],
        });
    },
};
