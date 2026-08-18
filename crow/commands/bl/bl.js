"use strict";

const blacklistRepo = require("../../db/repositories/blacklistRepo");
const logsConfigRepo = require("../../db/repositories/logsConfigRepo");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { extractUserId } = require("../../utils/args");

// CrowBL: cross-guild network blacklist. Unlike CrowALL's +bl (admin/bl.js,
// per-guild, purely informational), this list is global and enforced by
// blacklistService.enforceOnJoin() on every guildMemberAdd across ALL guilds
// running this bot — being added here auto-bans the user on their next join.
module.exports = {
    name: "gbl",
    category: "bl",
    description: "Ajoute un utilisateur à la blacklist.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const targetId = extractUserId(ctx.args[0]);
        if (!targetId) throw new UsageError("gbl @user [raison]");

        const reason = ctx.args.slice(1).join(" ") || null;
        blacklistRepo.globalAdd(targetId, reason, ctx.author.id);

        await logsConfigRepo.postLog(ctx.client, ctx.identity, ctx.guildId, "blacklist", {
            title: "⛔ Ajout à la blacklist globale",
            color: "#ED4245",
            fields: [
                { name: "Utilisateur", value: `<@${targetId}> (${targetId})` },
                { name: "Par", value: `${ctx.author}` },
                { name: "Raison", value: reason || "Aucune raison fournie" },
            ],
        });

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "⛔ Blacklist globale",
                    description: `<@${targetId}> a été ajouté à la liste noire **globale** (réseau). Il sera automatiquement banni s'il rejoint n'importe quel serveur géré par ce bot — distinct de la liste noire informative par serveur de CrowALL.`,
                    fields: [{ name: "Raison", value: reason || "Aucune raison fournie" }],
                }),
            ],
        });
    },
};
