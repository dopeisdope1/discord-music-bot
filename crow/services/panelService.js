"use strict";

const {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ChannelSelectMenuBuilder,
    ChannelType,
    MessageFlags,
} = require("discord.js");
const guardConfigRepo = require("../db/repositories/guardConfigRepo");
const voiceRepo = require("../db/repositories/voiceRepo");
const sanctionsRepo = require("../db/repositories/sanctionsRepo");
const leashRepo = require("../db/repositories/leashRepo");
const logsConfigRepo = require("../db/repositories/logsConfigRepo");
const { registerButtonHandler } = require("../core/interactionRegistry");
const { resolvePermission } = require("../core/permissions/resolvePermission");
const { LEVEL } = require("../core/permissions/permissionLevels");

// [logType, friendly label] per identity, matching the dedicated log category
// each bot got during setup (see the one-off restructuring script's PLAN).
const LOG_TYPES_BY_IDENTITY = {
    crowall: [
        ["moderation", "Sanctions"], ["roles", "Rôles"], ["messages", "Messages"], ["voice", "Vocal"],
        ["join", "Arrivées"], ["leave", "Départs"], ["channels", "Salons"], ["bots", "Bots"],
        ["webhooks", "Webhooks"], ["emojis", "Emojis/Stickers"], ["boosts", "Boosts"],
        ["server", "Serveur"], ["invites", "Invitations"], ["raid", "Antiraid"], ["automod", "Automod"],
    ],
    crowprotect: [["raid", "Antiraid"], ["antidown", "Anti-down"]],
    crowgestion: [["moderation", "Sanctions"], ["blacklist", "Blacklist"], ["laisse", "Laisse"]],
    crowguard: [["raid", "Secur"], ["blr", "BLR"], ["rolelimit", "Limite de rôle"]],
    crowmaster: [["voice", "Vocal"], ["tempvoc", "Salons temporaires"], ["votekick", "Vote-kick"]],
};

// Which guard_config keys each identity's panel exposes as a toggle dropdown.
const GUARD_KEYS_BY_IDENTITY = {
    crowall: [
        "antiban", "antibot", "antichannel", "antideco", "antieveryone",
        "antijoin", "antikick", "antilink", "antirole", "antiupdate", "antiwebhook",
    ],
    crowprotect: [
        "antiban", "antibot", "antichannel", "antideco",
        "antieveryone", "antirole", "antiunban", "antiwebhook",
    ],
    crowguard: ["antirole"],
};

const GUARD_LABELS = {
    antiban: "Anti-ban", antibot: "Anti-bot", antichannel: "Anti-salon", antideco: "Anti-déconnexion",
    antieveryone: "Anti-@everyone", antijoin: "Anti-arrivée massive", antikick: "Anti-kick",
    antilink: "Anti-lien", antirole: "Anti-rôle (secur)", antiunban: "Anti-débannissement",
    antiupdate: "Anti-modification", antiwebhook: "Anti-webhook",
};

function guardStatusLines(guildId, identityKey, keys) {
    return keys
        .map((key) => {
            const cfg = guardConfigRepo.getConfig(guildId, identityKey, key);
            const on = Boolean(cfg?.enabled);
            return `${on ? "✅" : "❌"} **${GUARD_LABELS[key] || key}**`;
        })
        .join("\n");
}

function buildGuardSelect(identityKey, keys) {
    return new StringSelectMenuBuilder()
        .setCustomId(`panel:${identityKey}:guards`)
        .setPlaceholder("⚙️ Activer/désactiver une protection")
        .addOptions(
            keys.map((key) =>
                new StringSelectMenuOptionBuilder().setLabel(GUARD_LABELS[key] || key).setValue(key)
            )
        );
}

function buildPunitionSelect(identityKey) {
    return new StringSelectMenuBuilder()
        .setCustomId(`panel:${identityKey}:punition`)
        .setPlaceholder("🔨 Sanction par défaut (appliquée à toutes les gardes)")
        .addOptions(
            new StringSelectMenuOptionBuilder().setLabel("Kick").setValue("kick"),
            new StringSelectMenuOptionBuilder().setLabel("Ban").setValue("ban"),
            new StringSelectMenuOptionBuilder().setLabel("Mute").setValue("mute")
        );
}

function buildQuickActionsSelect(identityKey) {
    return new StringSelectMenuBuilder()
        .setCustomId(`panel:${identityKey}:quick`)
        .setPlaceholder("🔎 Actions rapides")
        .addOptions(
            new StringSelectMenuOptionBuilder().setLabel("Sanctions actives").setValue("sanctions"),
            new StringSelectMenuOptionBuilder().setLabel("Blacklist globale").setValue("blacklist"),
            new StringSelectMenuOptionBuilder().setLabel("Membres en laisse").setValue("laisse")
        );
}

function buildVoiceSelect(identityKey) {
    return new StringSelectMenuBuilder()
        .setCustomId(`panel:${identityKey}:voice`)
        .setPlaceholder("🔊 Réglages vocaux")
        .addOptions(
            new StringSelectMenuOptionBuilder().setLabel("Activer le mode déconnexion").setValue("deco_on"),
            new StringSelectMenuOptionBuilder().setLabel("Désactiver le mode déconnexion").setValue("deco_off"),
            new StringSelectMenuOptionBuilder().setLabel("Voir les salons vocaux actifs").setValue("list")
        );
}

function buildQuickActionsText(guildId, value) {
    if (value === "sanctions") return `📋 ${sanctionsRepo.countByGuild(guildId)} sanction(s) enregistrée(s) sur ce serveur.`;
    if (value === "blacklist") {
        const count = require("../db/connection").getDb().prepare("SELECT COUNT(*) AS n FROM global_blacklist").get().n;
        return `🚫 ${count} utilisateur(s) dans la blacklist globale.`;
    }
    if (value === "laisse") return `⛓️ ${leashRepo.listByGuild(guildId).length} membre(s) actuellement en laisse.`;
    return "";
}

function buildLogsSelect(guildId, identityKey) {
    const types = LOG_TYPES_BY_IDENTITY[identityKey] || [];
    return new StringSelectMenuBuilder()
        .setCustomId(`panel:${identityKey}:logs`)
        .setPlaceholder("📋 Configurer un salon de logs")
        .addOptions(
            types.map(([logType, label]) => {
                const channelId = logsConfigRepo.getChannel(guildId, identityKey, logType);
                return new StringSelectMenuOptionBuilder()
                    .setLabel(label)
                    .setValue(logType)
                    .setDescription(channelId ? "Configuré" : "Non configuré");
            })
        );
}

function buildPanel(ctx) {
    const { guildId, identity } = ctx;
    const guardKeys = GUARD_KEYS_BY_IDENTITY[identity.key];

    const container = new ContainerBuilder().setAccentColor(
        parseInt((identity.themeColor || "#5865F2").replace("#", ""), 16)
    );

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## 🐦 ${identity.displayName} — Panneau de configuration`)
    );
    container.addSeparatorComponents(new SeparatorBuilder());

    if (guardKeys) {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(guardStatusLines(guildId, identity.key, guardKeys))
        );
        container.addActionRowComponents(new ActionRowBuilder().addComponents(buildGuardSelect(identity.key, guardKeys)));
    }

    if (identity.key === "crowall" || identity.key === "crowprotect") {
        container.addActionRowComponents(new ActionRowBuilder().addComponents(buildPunitionSelect(identity.key)));
    }

    if (identity.key === "crowgestion") {
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent("Sélectionne une action ci-dessous pour afficher les chiffres du serveur.")
        );
        container.addActionRowComponents(new ActionRowBuilder().addComponents(buildQuickActionsSelect(identity.key)));
    }

    if (identity.key === "crowmaster") {
        const config = voiceRepo.getConfig(guildId);
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                `Mode déconnexion : ${config?.deco_mode ? "✅ activé" : "❌ désactivé"}`
            )
        );
        container.addActionRowComponents(new ActionRowBuilder().addComponents(buildVoiceSelect(identity.key)));
    }

    if (LOG_TYPES_BY_IDENTITY[identity.key]) {
        container.addSeparatorComponents(new SeparatorBuilder());
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent("**📋 Logs**"));
        container.addActionRowComponents(new ActionRowBuilder().addComponents(buildLogsSelect(guildId, identity.key)));
    }

    return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

async function handleInteraction(interaction) {
    const [, identityKey, menuKind, extra] = interaction.customId.split(":");

    if (resolvePermission(interaction.member) < LEVEL.ADMIN) {
        return interaction.reply({ content: "❌ Réservé aux admins.", ephemeral: true });
    }

    const guildId = interaction.guild.id;
    const value = interaction.values[0];

    if (menuKind === "logs") {
        const label = (LOG_TYPES_BY_IDENTITY[identityKey] || []).find(([type]) => type === value)?.[1] || value;
        const channelSelect = new ChannelSelectMenuBuilder()
            .setCustomId(`panel:${identityKey}:setlog:${value}`)
            .setPlaceholder(`Choisis le salon pour "${label}"`)
            .addChannelTypes(ChannelType.GuildText);
        await interaction.reply({
            content: `📋 Sélectionne le salon pour les logs **${label}** :`,
            components: [new ActionRowBuilder().addComponents(channelSelect)],
            ephemeral: true,
        });
        return;
    }

    if (menuKind === "setlog") {
        const channelId = interaction.values[0];
        logsConfigRepo.setChannel(guildId, identityKey, extra, channelId);
        // This confirmation replaces the ephemeral channel-picker prompt, not the
        // original (persistent) panel message — reopen `panel` to see it reflected.
        await interaction.update({ content: `✅ Salon de logs mis à jour : <#${channelId}>.`, components: [] });
        return;
    }

    if (menuKind === "guards") {
        const enabled = guardConfigRepo.toggle(guildId, identityKey, value);
        await interaction.reply({
            content: `${enabled ? "✅" : "❌"} **${GUARD_LABELS[value] || value}** ${enabled ? "activé" : "désactivé"}.`,
            ephemeral: true,
        });
    } else if (menuKind === "punition") {
        const keys = GUARD_KEYS_BY_IDENTITY[identityKey] || [];
        for (const key of keys) guardConfigRepo.setPunition(guildId, identityKey, key, value);
        await interaction.reply({ content: `🔨 Sanction par défaut réglée sur **${value}**.`, ephemeral: true });
    } else if (menuKind === "quick") {
        await interaction.reply({ content: buildQuickActionsText(guildId, value), ephemeral: true });
        return;
    } else if (menuKind === "voice") {
        if (value === "list") {
            const active = voiceRepo.listByGuild(guildId).filter((c) => c.is_temp);
            await interaction.reply({
                content: active.length ? `🔊 ${active.length} salon(s) vocal(aux) actif(s).` : "Aucun salon vocal temporaire actif.",
                ephemeral: true,
            });
            return;
        }
        voiceRepo.setConfigField(guildId, "deco_mode", value === "deco_on" ? 1 : 0);
        await interaction.reply({ content: `🔊 Mode déconnexion ${value === "deco_on" ? "activé" : "désactivé"}.`, ephemeral: true });
    }

    // Refresh the panel message itself so guard/voice toggles are reflected live.
    if (menuKind === "guards" || menuKind === "voice") {
        const identity = require("../identities").find((i) => i.key === identityKey);
        if (identity) {
            const panel = buildPanel({ guildId, identity });
            await interaction.message.edit(panel).catch(() => {});
        }
    }
}

registerButtonHandler("panel", handleInteraction);

module.exports = { buildPanel };
