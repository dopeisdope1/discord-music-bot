"use strict";

const { LEVEL } = require("../../core/permissions/permissionLevels");
const guardConfigRepo = require("../../db/repositories/guardConfigRepo");
const { extractRoleId, extractChannelId } = require("../../utils/args");
const { UsageError } = require("../../core/errors");

function getSettings(guildId, identityKey) {
    const cfg = guardConfigRepo.getConfig(guildId, identityKey, "antidown");
    return cfg?.settings_json ? JSON.parse(cfg.settings_json) : {};
}

function saveSettings(guildId, identityKey, settings) {
    guardConfigRepo.setSettings(guildId, identityKey, "antidown", settings);
}

module.exports = {
    name: "antidown",
    category: "antiraid",
    description: "Anti-nuke: neutralise un compte qui supprime salons/rôles en rafale, même un admin.",
    permLevel: LEVEL.ADMIN,
    async execute(ctx) {
        const sub = (ctx.args[0] || "").toLowerCase();
        const settings = getSettings(ctx.guildId, ctx.identity.key);

        if (!sub) {
            const cfg = guardConfigRepo.getConfig(ctx.guildId, ctx.identity.key, "antidown");
            return ctx.reply({
                embeds: [
                    ctx.embed({
                        title: "🚨 Anti-down",
                        description: [
                            `État : ${cfg?.enabled ? "✅ activé" : "❌ désactivé"}`,
                            `Seuil : ${settings.maxActions ?? 3} actions / ${(settings.windowMs ?? 5000) / 1000}s`,
                            `Catégories exemptées : ${(settings.bypassCategories || []).length}`,
                            `Réactivation auto des permissions : ${settings.reactivatePerms ? "oui" : "non"}`,
                            "",
                            "Sous-commandes : `on`/`off`, `seuil <n> <secondes>`, `bypass <#categorie>`, `unbypass <#categorie>`, `reactivation on/off [minutes]`",
                        ].join("\n"),
                    }),
                ],
            });
        }

        if (sub === "on" || sub === "off") {
            guardConfigRepo.setEnabled(ctx.guildId, ctx.identity.key, "antidown", sub === "on");
            return ctx.reply(sub === "on" ? "✅ Anti-down activé." : "❌ Anti-down désactivé.");
        }

        if (sub === "seuil") {
            const max = Number(ctx.args[1]);
            const seconds = Number(ctx.args[2]);
            if (!Number.isFinite(max) || max < 1 || !Number.isFinite(seconds) || seconds < 1) {
                throw new UsageError("antidown seuil <nombre_actions> <secondes>");
            }
            saveSettings(ctx.guildId, ctx.identity.key, { ...settings, maxActions: max, windowMs: seconds * 1000 });
            return ctx.reply(`✅ Seuil réglé : ${max} actions / ${seconds}s.`);
        }

        if (sub === "bypass" || sub === "unbypass") {
            const channelId = extractChannelId(ctx.args[1]);
            if (!channelId) throw new UsageError(`antidown ${sub} #categorie`);
            const list = new Set(settings.bypassCategories || []);
            if (sub === "bypass") list.add(channelId);
            else list.delete(channelId);
            saveSettings(ctx.guildId, ctx.identity.key, { ...settings, bypassCategories: [...list] });
            return ctx.reply(`✅ Catégorie ${sub === "bypass" ? "exemptée" : "retirée des exemptions"}.`);
        }

        if (sub === "reactivation") {
            const state = (ctx.args[1] || "").toLowerCase();
            if (state !== "on" && state !== "off") throw new UsageError("antidown reactivation on/off [minutes]");
            const minutes = Number(ctx.args[2]) || 5;
            saveSettings(ctx.guildId, ctx.identity.key, {
                ...settings,
                reactivatePerms: state === "on",
                reactivateDelayMs: minutes * 60_000,
            });
            return ctx.reply(`✅ Réactivation automatique ${state === "on" ? `activée (${minutes} min)` : "désactivée"}.`);
        }

        throw new UsageError("antidown [on|off|seuil|bypass|unbypass|reactivation]");
    },
};
