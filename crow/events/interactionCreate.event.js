"use strict";

const { Events } = require("discord.js");
const { dispatchButton } = require("../core/interactionRegistry");

module.exports = {
    name: Events.InteractionCreate,
    async execute(client, identity, interaction) {
        // isModalSubmit : le panneau de configuration ouvre des modales pour
        // les réglages en texte libre (préfixe, couleur, messages d'accueil).
        if (interaction.isButton() || interaction.isAnySelectMenu?.() || interaction.isModalSubmit?.()) {
            await dispatchButton(interaction, client, identity).catch(() => {});
        }
    },
};
