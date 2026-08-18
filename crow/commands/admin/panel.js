"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const { buildPanel } = require("../../services/panelService");

module.exports = {
    name: "panel",
    category: "admin",
    description: "Affiche un panneau de configuration interactif (menus déroulants).",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const panel = buildPanel(ctx);
        await ctx.message.channel.send(panel);
    },
};
