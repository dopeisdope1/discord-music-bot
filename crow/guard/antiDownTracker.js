"use strict";

const guardConfigRepo = require("../db/repositories/guardConfigRepo");

// Ephemeral, in-memory action-velocity tracker shared by every antidown.*.guard.js
// definition (they all register under the same guard_key "antidown", so they
// share one guard_config row and one counter per executor).
const actionLog = new Map(); // "guildId:identityKey:executorId" -> timestamps[]

function getSettings(guildId, identityKey) {
    const cfg = guardConfigRepo.getConfig(guildId, identityKey, "antidown");
    const settings = cfg?.settings_json ? JSON.parse(cfg.settings_json) : {};
    return {
        maxActions: settings.maxActions ?? 3,
        windowMs: settings.windowMs ?? 5000,
        bypassCategories: settings.bypassCategories ?? [],
        reactivatePerms: settings.reactivatePerms ?? false,
        reactivateDelayMs: settings.reactivateDelayMs ?? 300_000,
    };
}

function recordAction(guildId, identityKey, executorId, settings) {
    const key = `${guildId}:${identityKey}:${executorId}`;
    const now = Date.now();
    const list = (actionLog.get(key) || []).filter((t) => now - t < settings.windowMs);
    list.push(now);
    actionLog.set(key, list);
    return list.length;
}

function isCategoryBypassed(settings, categoryId) {
    return Boolean(categoryId) && settings.bypassCategories.includes(categoryId);
}

// Shared punish action for every antidown.*.guard.js definition: strip the
// offending executor's roles, log it, and optionally schedule restoration.
async function triggerAntiDown(ctx, reasonLabel) {
    const moderationService = require("../services/moderationService");
    const logsConfigRepo = require("../db/repositories/logsConfigRepo");

    const guild = ctx.match.guild || ctx.match.channel?.guild || ctx.match.role?.guild;
    if (!guild || !ctx.executorId) return;

    const member = await guild.members.fetch(ctx.executorId).catch(() => null);
    if (!member) return;

    const removedRoleIds = await moderationService.stripAllRoles(
        member,
        `Garde antidown: seuil d'actions destructrices dépassé (${reasonLabel})`
    );

    await logsConfigRepo.postLog(guild.client, ctx.identity, guild.id, "antidown", {
        title: "🚨 Anti-down déclenché",
        color: "#ED4245",
        fields: [
            { name: "Membre neutralisé", value: `${member} (${member.id})` },
            { name: "Déclencheur", value: reasonLabel },
            { name: "Rôles retirés", value: String(removedRoleIds.length) },
        ],
    });

    if (ctx.settings?.reactivatePerms && removedRoleIds.length > 0) {
        setTimeout(() => {
            moderationService.restoreRoles(guild, ctx.executorId, removedRoleIds).catch(() => {});
        }, ctx.settings.reactivateDelayMs);
    }
}

module.exports = { getSettings, recordAction, isCategoryBypassed, triggerAntiDown };
