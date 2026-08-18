"use strict";

const { BotError } = require("../../core/errors");
const { LEVEL } = require("../../core/permissions/permissionLevels");

// No zip library is installed (adding one would be a new npm dependency, out
// of scope) so this exports a plain-text "name: url" list instead of a real
// archive of image files — see final report.
module.exports = {
    name: "export-emojis",
    category: "gestion",
    description: "Exporte les emojis du serveur sous archive.",
    permLevel: LEVEL.MOD,
    aliases: [],
    async execute(ctx) {
        const emojis = [...ctx.guild.emojis.cache.values()];
        if (!emojis.length) throw new BotError("Ce serveur ne possède aucun emoji personnalisé.");

        const lines = emojis.map((e) => `${e.name}: ${e.imageURL()}`);
        const buffer = Buffer.from(lines.join("\n"), "utf8");

        await ctx.reply({
            content:
                "📦 Export terminé — ceci est une liste de liens vers les images (pas une archive de fichiers image, faute de dépendance zip installée).",
            files: [{ attachment: buffer, name: "emojis.txt" }],
        });
    },
};
