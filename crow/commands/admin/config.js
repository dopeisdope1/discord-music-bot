"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const { buildPanel } = require("../../services/panelService");

module.exports = {
    name: "config",
    category: "admin",
    description: "Panneau de configuration interactif (protections, sanctions, logs).",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const panel = buildPanel(ctx);
        await ctx.message.channel.send(panel);
    },
};
