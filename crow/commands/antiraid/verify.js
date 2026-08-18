"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const { UsageError } = require("../../core/errors");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");
const { extractRoleId } = require("../../utils/args");

// Config command for the captcha join-verification guard (guard_key "captcha").
// The actual join-time captcha flow lives in services/captchaService.js and is
// wired in events/guildMemberAdd.event.js — this only edits its config.
module.exports = {
    name: "verify",
    category: "antiraid",
    description: "Gère le système de vérification captcha.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const sub = (ctx.args[0] || "").toLowerCase();

        if (!sub) {
            const config = guardConfigRepo.getConfig(ctx.guildId, ctx.identity.key, "captcha");
            const settings = config?.settings_json ? JSON.parse(config.settings_json) : {};
            const roleLine = settings.verifiedRoleId ? `<@&${settings.verifiedRoleId}>` : "aucun";
            await ctx.reply(
                `🔎 Vérification captcha : ${config?.enabled ? "✅ activée" : "❌ désactivée"}\nRôle attribué : ${roleLine}`
            );
            return;
        }

        if (sub === "on" || sub === "off") {
            guardConfigRepo.setEnabled(ctx.guildId, ctx.identity.key, "captcha", sub === "on");
            await ctx.reply(sub === "on" ? "✅ Vérification captcha activée." : "❌ Vérification captcha désactivée.");
            return;
        }

        if (sub === "role") {
            const roleId = extractRoleId(ctx.args[1]);
            if (!roleId) throw new UsageError("verify role @role");

            const config = guardConfigRepo.getConfig(ctx.guildId, ctx.identity.key, "captcha");
            const settings = config?.settings_json ? JSON.parse(config.settings_json) : {};
            settings.verifiedRoleId = roleId;
            guardConfigRepo.setSettings(ctx.guildId, ctx.identity.key, "captcha", settings);

            await ctx.reply(`✅ Rôle de vérification défini sur <@&${roleId}>.`);
            return;
        }

        throw new UsageError("verify [on|off|role @role]");
    },
};
