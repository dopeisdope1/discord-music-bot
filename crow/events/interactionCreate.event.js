"use strict";

const { Events } = require("discord.js");
const { dispatchButton } = require("../core/interactionRegistry");

module.exports = {
    name: Events.InteractionCreate,
    async execute(client, identity, interaction) {
        if (interaction.isButton() || interaction.isAnySelectMenu?.()) {
            await dispatchButton(interaction, client, identity).catch(() => {});
        }
    },
};
