"use strict";

const blacklistRepo = require("../../db/repositories/blacklistRepo");
const { UsageError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

// NOTE: this is CrowBL's setdm (the ban-DM template), primary/first-listed
// owner of the "setdm" name in the crowgestion identity. CrowLAISSE's
// equivalent command was renamed to "leashdm" (see laisse/leashdm.js) to
// avoid a name collision within the same command registry.
module.exports = {
    name: "setdm",
    category: "bl",
    description: "Définir le message privé envoyé lors d'un bannissement.",
    permLevel: LEVEL.ADMIN,
    aliases: [],
    async execute(ctx) {
        const message = ctx.args.join(" ").trim();
        if (!message) throw new UsageError("setdm <message>");

        blacklistRepo.setDmTemplate(ctx.guildId, message);

        await ctx.reply({
            embeds: [
                ctx.embed({
                    title: "✉️ Message DM blacklist",
                    description:
                        "Le message privé envoyé lors d'un bannissement automatique (blacklist globale) a été mis à jour.\nUtilise `{reason}` dans ton message pour insérer automatiquement la raison de la blacklist.",
                    fields: [{ name: "Nouveau message", value: message }],
                }),
            ],
        });
    },
};
