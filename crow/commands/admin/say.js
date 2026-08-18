"use strict";

const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

module.exports = {
    name: "say",
    category: "admin",
    description: "Fait parler le bot dans le salon.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const text = ctx.args.join(" ").trim();
        if (!text) throw new UsageError("say [message]");

        await ctx.message.delete().catch(() => {});
        await ctx.send(text);
    },
};
