"use strict";

const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, MessageFlags } = require("discord.js");
const permissionRepo = require("../../db/repositories/permissionRepo");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { LEVELS, levelLabel } = require("../../utils/permView");

const MAX_BLOCK = 900;

function truncateMentions(mentions) {
    const joined = mentions.join(", ");
    if (joined.length <= MAX_BLOCK) return joined;

    let kept = 0;
    let len = 0;
    for (const m of mentions) {
        if (len + m.length + 2 > MAX_BLOCK) break;
        len += m.length + 2;
        kept += 1;
    }
    return `${mentions.slice(0, kept).join(", ")} … (+${mentions.length - kept})`;
}

module.exports = {
    name: "helpall",
    category: "public",
    description: "Affiche les paliers de permission et les rôles/membres associés.",
    permLevel: LEVEL.NONE,
    aliases: [],
    async execute(ctx) {
        const roles = permissionRepo.listRoles(ctx.guildId);
        const users = permissionRepo.listUsers(ctx.guildId);

        const container = new ContainerBuilder();
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                "## Permissions\n> Voici les différents paliers ainsi que les rôles et membres associés"
            )
        );
        container.addSeparatorComponents(new SeparatorBuilder());

        // Le palier 0 n'a pas de titulaires : il est ouvert à tout le monde.
        for (const level of LEVELS.filter((l) => l !== LEVEL.NONE)) {
            const mentions = [
                ...roles.filter((r) => r.level === level).map((r) => `<@&${r.role_id}>`),
                ...users.filter((u) => u.level === level).map((u) => `<@${u.user_id}>`),
            ];

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `**${levelLabel(level)}**\n> ${mentions.length ? truncateMentions(mentions) : "*Aucun rôle ni membre*"}`
                )
            );
        }

        container.addSeparatorComponents(new SeparatorBuilder());
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                "Le propriétaire du serveur et tout membre ayant la permission Discord **Administrateur** " +
                    "sont automatiquement au palier 3, sans configuration.\n" +
                    "Voir les commandes de chaque palier : `perms`."
            )
        );

        await ctx.send({ flags: MessageFlags.IsComponentsV2, components: [container] });
    },
};
