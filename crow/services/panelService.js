"use strict";

const {
    ContainerBuilder,
    TextDisplayBuilder,
    SeparatorBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    MessageFlags,
} = require("discord.js");
const guardConfigRepo = require("../db/repositories/guardConfigRepo");
const voiceRepo = require("../db/repositories/voiceRepo");
const sanctionsRepo = require("../db/repositories/sanctionsRepo");
const leashRepo = require("../db/repositories/leashRepo");
const logsConfigRepo = require("../db/repositories/logsConfigRepo");
const guildSettingsRepo = require("../db/repositories/guildSettingsRepo");
const permissionRepo = require("../db/repositories/permissionRepo");
const { registerButtonHandler } = require("../core/interactionRegistry");
const { resolvePermission } = require("../core/permissions/resolvePermission");
const { LEVEL, LEVEL_NAMES } = require("../core/permissions/permissionLevels");

// [logType, libellé] par identité, calqué sur la catégorie de logs dédiée de
// chaque bot.
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

// Rubriques du menu de navigation, dans l'ordre d'affichage.
const SECTIONS = [
    { key: "home", label: "Accueil", emoji: "🏠", description: "Vue d'ensemble de la configuration" },
    { key: "guards", label: "Protections", emoji: "🛡️", description: "Anti-raid et sanction appliquée" },
    { key: "logs", label: "Logs", emoji: "📋", description: "Salons de journalisation" },
    { key: "perms", label: "Permissions", emoji: "🔐", description: "Rôles et membres par palier" },
    { key: "general", label: "Général", emoji: "⚙️", description: "Préfixe, couleur, langue, autorole" },
    { key: "welcome", label: "Bienvenue", emoji: "👋", description: "Messages d'arrivée et de départ" },
    { key: "voice", label: "Vocal", emoji: "🔊", description: "Réglages des salons vocaux" },
    { key: "automod", label: "Automod", emoji: "🤖", description: "Modération automatique et logs" },
];

const id = (identityKey, ...parts) => ["panel", identityKey, ...parts].join(":");
const onOff = (v) => (v ? "✅ activé" : "❌ désactivé");

function buildNavSelect(identityKey, current) {
    return new StringSelectMenuBuilder()
        .setCustomId(id(identityKey, "nav"))
        .setPlaceholder("Choisis une rubrique à configurer")
        .addOptions(
            SECTIONS.map((s) =>
                new StringSelectMenuOptionBuilder()
                    .setLabel(s.label)
                    .setDescription(s.description)
                    .setEmoji(s.emoji)
                    .setValue(s.key)
                    .setDefault(s.key === current)
            )
        );
}

// ---- Rubrique : accueil ----------------------------------------------------

function homeText(guildId, identity) {
    const settings = guildSettingsRepo.getSettings(guildId, identity.key) || {};
    const guardKeys = GUARD_KEYS_BY_IDENTITY[identity.key] || [];
    const activeGuards = guardKeys.filter((k) => guardConfigRepo.getConfig(guildId, identity.key, k)?.enabled).length;
    const logTypes = LOG_TYPES_BY_IDENTITY[identity.key] || [];
    const configuredLogs = logTypes.filter(([t]) => logsConfigRepo.getChannel(guildId, identity.key, t)).length;
    const perms = permissionRepo.listRoles(guildId).length + permissionRepo.listUsers(guildId).length;

    return [
        `> **Préfixe** : \`${settings.prefix || identity.defaultPrefix}\``,
        `> **Couleur** : \`${settings.theme_color || identity.themeColor}\``,
        `> **Protections actives** : ${activeGuards}/${guardKeys.length}`,
        `> **Salons de logs configurés** : ${configuredLogs}/${logTypes.length}`,
        `> **Rôles/membres avec un palier** : ${perms}`,
        `> **Automod** : ${onOff(settings.automod_enabled)}`,
        "",
        "Sélectionne une rubrique dans le menu ci-dessous pour la configurer.",
    ].join("\n");
}

// ---- Rubrique : protections ------------------------------------------------

function guardsText(guildId, identityKey, keys) {
    const punition = guardConfigRepo.getConfig(guildId, identityKey, keys[0])?.punition || "kick";
    return (
        keys.map((k) => `${guardConfigRepo.getConfig(guildId, identityKey, k)?.enabled ? "✅" : "❌"} **${GUARD_LABELS[k] || k}**`).join("\n") +
        `\n\n> Sanction appliquée : **${punition}**`
    );
}

// ---- Rubrique : permissions ------------------------------------------------

function permsText(guildId) {
    const roles = permissionRepo.listRoles(guildId);
    const users = permissionRepo.listUsers(guildId);

    return [LEVEL.STAFF, LEVEL.MOD, LEVEL.ADMIN]
        .map((level) => {
            const mentions = [
                ...roles.filter((r) => r.level === level).map((r) => `<@&${r.role_id}>`),
                ...users.filter((u) => u.level === level).map((u) => `<@${u.user_id}>`),
            ];
            const list = mentions.join(", ");
            return `**Permission ${level} (${LEVEL_NAMES[level]})**\n> ${
                list.length > 900 ? `${list.slice(0, 900)}…` : list || "*Aucun rôle ni membre*"
            }`;
        })
        .join("\n");
}

// ---- Rubrique : général / bienvenue ---------------------------------------

function generalText(guildId, identity) {
    const s = guildSettingsRepo.getSettings(guildId, identity.key) || {};
    return [
        `> **Préfixe** : \`${s.prefix || identity.defaultPrefix}\``,
        `> **Couleur des embeds** : \`${s.theme_color || identity.themeColor}\``,
        `> **Langue** : \`${s.lang || "fr"}\``,
        `> **Rôle automatique** : ${s.auto_role_id ? `<@&${s.auto_role_id}>` : "*aucun*"}`,
    ].join("\n");
}

function welcomeText(guildId, identity) {
    const s = guildSettingsRepo.getSettings(guildId, identity.key) || {};
    return [
        `> **Salon d'arrivée** : ${s.join_channel_id ? `<#${s.join_channel_id}>` : "*aucun*"}`,
        `> **Message d'arrivée** : ${s.join_message ? `\`${s.join_message.slice(0, 150)}\`` : "*aucun*"}`,
        `> **Salon de départ** : ${s.leave_channel_id ? `<#${s.leave_channel_id}>` : "*aucun*"}`,
        `> **Message de départ** : ${s.leave_message ? `\`${s.leave_message.slice(0, 150)}\`` : "*aucun*"}`,
        "",
        "Variables disponibles : `{user}`, `{server}`, `{count}`.",
    ].join("\n");
}

/**
 * Panneau de configuration, rubrique par rubrique. Volontairement SANS
 * setAccentColor : pas de barre de couleur sur le côté.
 */
function buildPanel(ctx, section = "home") {
    const { guildId, identity } = ctx;
    const key = identity.key;
    const container = new ContainerBuilder();
    const meta = SECTIONS.find((s) => s.key === section) || SECTIONS[0];

    container.addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`## ${identity.displayName} — Configuration\n### ${meta.emoji} ${meta.label}`)
    );
    container.addSeparatorComponents(new SeparatorBuilder());

    const rows = [];

    if (section === "guards") {
        const keys = GUARD_KEYS_BY_IDENTITY[key];
        if (keys) {
            container.addTextDisplayComponents(new TextDisplayBuilder().setContent(guardsText(guildId, key, keys)));
            rows.push(
                new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(id(key, "guards"))
                        .setPlaceholder("Activer/désactiver une protection")
                        .addOptions(keys.map((k) => new StringSelectMenuOptionBuilder().setLabel(GUARD_LABELS[k] || k).setValue(k)))
                ),
                new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(id(key, "punition"))
                        .setPlaceholder("Sanction appliquée par les protections")
                        .addOptions(
                            new StringSelectMenuOptionBuilder().setLabel("Kick").setValue("kick"),
                            new StringSelectMenuOptionBuilder().setLabel("Ban").setValue("ban"),
                            new StringSelectMenuOptionBuilder().setLabel("Mute").setValue("mute")
                        )
                )
            );
        } else {
            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent("*Aucune protection gérée par ce bot.*")
            );
        }
    } else if (section === "logs") {
        const types = LOG_TYPES_BY_IDENTITY[key] || [];
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                types
                    .map(([t, label]) => {
                        const channelId = logsConfigRepo.getChannel(guildId, key, t);
                        return `${channelId ? "✅" : "❌"} **${label}** ${channelId ? `→ <#${channelId}>` : ""}`;
                    })
                    .join("\n") || "*Aucun type de log pour ce bot.*"
            )
        );
        if (types.length) {
            rows.push(
                new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId(id(key, "logs"))
                        .setPlaceholder("Configurer un salon de logs")
                        .addOptions(
                            types.map(([t, label]) =>
                                new StringSelectMenuOptionBuilder()
                                    .setLabel(label)
                                    .setValue(t)
                                    .setDescription(logsConfigRepo.getChannel(guildId, key, t) ? "Configuré" : "Non configuré")
                            )
                        )
                )
            );
        }
    } else if (section === "perms") {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(permsText(guildId)));
        rows.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(id(key, "permlevel"))
                    .setPlaceholder("Attribuer ou retirer un palier")
                    .addOptions(
                        new StringSelectMenuOptionBuilder().setLabel("Donner la Permission 1 (Staff)").setValue("1"),
                        new StringSelectMenuOptionBuilder().setLabel("Donner la Permission 2 (Mod)").setValue("2"),
                        new StringSelectMenuOptionBuilder().setLabel("Donner la Permission 3 (Admin)").setValue("3"),
                        new StringSelectMenuOptionBuilder().setLabel("Retirer le palier d'un rôle").setValue("0")
                    )
            )
        );
    } else if (section === "general") {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(generalText(guildId, identity)));
        rows.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(id(key, "lang"))
                    .setPlaceholder("Langue du bot")
                    .addOptions(
                        new StringSelectMenuOptionBuilder().setLabel("Français").setValue("fr"),
                        new StringSelectMenuOptionBuilder().setLabel("English").setValue("en")
                    )
            ),
            new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder().setCustomId(id(key, "autorole")).setPlaceholder("Rôle donné à l'arrivée")
            ),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(id(key, "modal", "prefix")).setLabel("Changer le préfixe").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(id(key, "modal", "theme_color")).setLabel("Changer la couleur").setStyle(ButtonStyle.Secondary)
            )
        );
    } else if (section === "welcome") {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(welcomeText(guildId, identity)));
        rows.push(
            new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId(id(key, "setchan", "join_channel_id"))
                    .setPlaceholder("Salon des arrivées")
                    .addChannelTypes(ChannelType.GuildText)
            ),
            new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder()
                    .setCustomId(id(key, "setchan", "leave_channel_id"))
                    .setPlaceholder("Salon des départs")
                    .addChannelTypes(ChannelType.GuildText)
            ),
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(id(key, "modal", "join_message")).setLabel("Message d'arrivée").setStyle(ButtonStyle.Secondary),
                new ButtonBuilder().setCustomId(id(key, "modal", "leave_message")).setLabel("Message de départ").setStyle(ButtonStyle.Secondary)
            )
        );
    } else if (section === "voice") {
        const config = voiceRepo.getConfig(guildId);
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(`> **Mode déconnexion** : ${onOff(config?.deco_mode)}`)
        );
        rows.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(id(key, "voice"))
                    .setPlaceholder("Réglages vocaux")
                    .addOptions(
                        new StringSelectMenuOptionBuilder().setLabel("Activer le mode déconnexion").setValue("deco_on"),
                        new StringSelectMenuOptionBuilder().setLabel("Désactiver le mode déconnexion").setValue("deco_off"),
                        new StringSelectMenuOptionBuilder().setLabel("Voir les salons vocaux actifs").setValue("list")
                    )
            )
        );
    } else if (section === "automod") {
        const s = guildSettingsRepo.getSettings(guildId, key) || {};
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                [
                    `> **AutoMod Discord** : ${onOff(s.automod_enabled)}`,
                    `> **Logs (interrupteur global)** : ${onOff(s.logs_master_enabled)}`,
                    "",
                    `> Sanctions enregistrées : **${sanctionsRepo.countByGuild(guildId)}**`,
                    `> Membres en laisse : **${leashRepo.listByGuild(guildId).length}**`,
                ].join("\n")
            )
        );
        rows.push(
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(id(key, "toggle"))
                    .setPlaceholder("Activer/désactiver")
                    .addOptions(
                        new StringSelectMenuOptionBuilder().setLabel("AutoMod : activer").setValue("automod_enabled:1"),
                        new StringSelectMenuOptionBuilder().setLabel("AutoMod : désactiver").setValue("automod_enabled:0"),
                        new StringSelectMenuOptionBuilder().setLabel("Logs : activer").setValue("logs_master_enabled:1"),
                        new StringSelectMenuOptionBuilder().setLabel("Logs : désactiver").setValue("logs_master_enabled:0")
                    )
            )
        );
    } else {
        container.addTextDisplayComponents(new TextDisplayBuilder().setContent(homeText(guildId, identity)));
    }

    container.addSeparatorComponents(new SeparatorBuilder());
    container.addActionRowComponents(new ActionRowBuilder().addComponents(buildNavSelect(key, meta.key)));
    for (const row of rows) container.addActionRowComponents(row);

    return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

// ---- Interactions ----------------------------------------------------------

const MODAL_FIELDS = {
    prefix: { label: "Nouveau préfixe", style: TextInputStyle.Short, max: 5 },
    theme_color: { label: "Couleur hexadécimale (#5865F2)", style: TextInputStyle.Short, max: 7 },
    join_message: { label: "Message d'arrivée", style: TextInputStyle.Paragraph, max: 1000 },
    leave_message: { label: "Message de départ", style: TextInputStyle.Paragraph, max: 1000 },
};

async function refreshPanel(interaction, identity, section) {
    const panel = buildPanel({ guildId: interaction.guild.id, identity }, section);
    await interaction.message?.edit(panel).catch(() => {});
}

async function handleInteraction(interaction) {
    const [, identityKey, kind, extra] = interaction.customId.split(":");
    const identity = require("../identities").find((i) => i.key === identityKey);
    if (!identity) return;

    if (resolvePermission(interaction.member) < LEVEL.ADMIN) {
        return interaction.reply({ content: "❌ Réservé aux admins.", flags: MessageFlags.Ephemeral });
    }

    const guildId = interaction.guild.id;
    const value = interaction.values?.[0];

    // Modale : bouton -> ouverture, puis soumission -> enregistrement.
    if (kind === "modal") {
        if (interaction.isModalSubmit()) {
            const raw = interaction.fields.getTextInputValue("value").trim();
            guildSettingsRepo.setField(guildId, identityKey, extra, raw || null);
            return interaction.reply({ content: `✅ **${MODAL_FIELDS[extra].label}** mis à jour.`, flags: MessageFlags.Ephemeral });
        }

        const field = MODAL_FIELDS[extra];
        const modal = new ModalBuilder().setCustomId(interaction.customId).setTitle(field.label.slice(0, 45));
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId("value")
                    .setLabel(field.label.slice(0, 45))
                    .setStyle(field.style)
                    .setMaxLength(field.max)
                    .setRequired(false)
            )
        );
        return interaction.showModal(modal);
    }

    if (kind === "nav") {
        return interaction.update(buildPanel({ guildId, identity }, value));
    }

    if (kind === "logs") {
        const label = (LOG_TYPES_BY_IDENTITY[identityKey] || []).find(([t]) => t === value)?.[1] || value;
        return interaction.reply({
            content: `Sélectionne le salon pour les logs **${label}** :`,
            components: [
                new ActionRowBuilder().addComponents(
                    new ChannelSelectMenuBuilder()
                        .setCustomId(id(identityKey, "setlog", value))
                        .setPlaceholder(`Salon pour "${label}"`)
                        .addChannelTypes(ChannelType.GuildText)
                ),
            ],
            flags: MessageFlags.Ephemeral,
        });
    }

    if (kind === "setlog") {
        logsConfigRepo.setChannel(guildId, identityKey, extra, value);
        return interaction.update({ content: `✅ Salon de logs mis à jour : <#${value}>.`, components: [] });
    }

    if (kind === "permlevel") {
        const level = Number(value);
        return interaction.reply({
            content:
                level === 0
                    ? "Sélectionne le rôle dont tu veux retirer le palier :"
                    : `Sélectionne le rôle qui recevra la **Permission ${level} (${LEVEL_NAMES[level]})** :`,
            components: [
                new ActionRowBuilder().addComponents(
                    new RoleSelectMenuBuilder().setCustomId(id(identityKey, "setperm", String(level))).setPlaceholder("Choisis un rôle")
                ),
            ],
            flags: MessageFlags.Ephemeral,
        });
    }

    if (kind === "setperm") {
        const level = Number(extra);
        if (level === 0) {
            permissionRepo.removeRoleLevel(guildId, value);
            return interaction.update({ content: `✅ Palier retiré à <@&${value}>.`, components: [] });
        }
        permissionRepo.setRoleLevel(guildId, value, level);
        return interaction.update({
            content: `✅ <@&${value}> a désormais la **Permission ${level} (${LEVEL_NAMES[level]})**.`,
            components: [],
        });
    }

    if (kind === "autorole") {
        guildSettingsRepo.setField(guildId, identityKey, "auto_role_id", value);
        await interaction.reply({ content: `✅ Rôle automatique : <@&${value}>.`, flags: MessageFlags.Ephemeral });
        return refreshPanel(interaction, identity, "general");
    }

    if (kind === "setchan") {
        guildSettingsRepo.setField(guildId, identityKey, extra, value);
        await interaction.reply({ content: `✅ Salon mis à jour : <#${value}>.`, flags: MessageFlags.Ephemeral });
        return refreshPanel(interaction, identity, "welcome");
    }

    if (kind === "lang") {
        guildSettingsRepo.setField(guildId, identityKey, "lang", value);
        await interaction.reply({ content: `✅ Langue : **${value}**.`, flags: MessageFlags.Ephemeral });
        return refreshPanel(interaction, identity, "general");
    }

    if (kind === "toggle") {
        const [field, raw] = value.split(":");
        guildSettingsRepo.setField(guildId, identityKey, field, Number(raw));
        await interaction.reply({ content: `✅ Réglage mis à jour.`, flags: MessageFlags.Ephemeral });
        return refreshPanel(interaction, identity, "automod");
    }

    if (kind === "guards") {
        const enabled = guardConfigRepo.toggle(guildId, identityKey, value);
        await interaction.reply({
            content: `${enabled ? "✅" : "❌"} **${GUARD_LABELS[value] || value}** ${enabled ? "activé" : "désactivé"}.`,
            flags: MessageFlags.Ephemeral,
        });
        return refreshPanel(interaction, identity, "guards");
    }

    if (kind === "punition") {
        for (const k of GUARD_KEYS_BY_IDENTITY[identityKey] || []) {
            guardConfigRepo.setPunition(guildId, identityKey, k, value);
        }
        await interaction.reply({ content: `✅ Sanction par défaut : **${value}**.`, flags: MessageFlags.Ephemeral });
        return refreshPanel(interaction, identity, "guards");
    }

    if (kind === "voice") {
        if (value === "list") {
            const active = voiceRepo.listByGuild(guildId).filter((c) => c.is_temp);
            return interaction.reply({
                content: active.length ? `🔊 ${active.length} salon(s) vocal(aux) actif(s).` : "Aucun salon vocal temporaire actif.",
                flags: MessageFlags.Ephemeral,
            });
        }
        voiceRepo.setConfigField(guildId, "deco_mode", value === "deco_on" ? 1 : 0);
        await interaction.reply({
            content: `🔊 Mode déconnexion ${value === "deco_on" ? "activé" : "désactivé"}.`,
            flags: MessageFlags.Ephemeral,
        });
        return refreshPanel(interaction, identity, "voice");
    }
}

registerButtonHandler("panel", handleInteraction);

module.exports = { buildPanel, SECTIONS };
