"use strict";

const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, MessageFlags } = require("discord.js");
const { LEVEL } = require("../../core/permissions/permissionLevels");
const { LEVELS, levelLabel, usableBy } = require("../../utils/permView");

const MAX_BLOCK = 900;

module.exports = {
    name: "perms",
    category: "public",
    description: "Affiche les paliers de permission et les commandes accessibles à chacun.",
    permLevel: LEVEL.NONE,
    aliases: [],
    async execute(ctx) {
        const container = new ContainerBuilder();

        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                "## Permissions liées aux commandes\n" +
                    "> Voici les différents paliers ainsi que les commandes accessibles"
            )
        );
        container.addSeparatorComponents(new SeparatorBuilder());

        // Cumulatif : un palier donne accès au sien et à tous ceux du dessous,
        // exactement comme le contrôle d'accès de core/messageRouter.js.
        for (const level of LEVELS) {
            const names = usableBy(ctx.identity, level).map((c) => c.name);

            let list = names.join(", ");
            if (list.length > MAX_BLOCK) {
                let kept = 0;
                let len = 0;
                for (const n of names) {
                    if (len + n.length + 2 > MAX_BLOCK) break;
                    len += n.length + 2;
                    kept += 1;
                }
                list = `${names.slice(0, kept).join(", ")} … (+${names.length - kept})`;
            }

            container.addTextDisplayComponents(
                new TextDisplayBuilder().setContent(
                    `**${levelLabel(level)}** — ${names.length} commande(s)\n> ${list || "*Aucune*"}`
                )
            );
        }

        container.addSeparatorComponents(new SeparatorBuilder());
        container.addTextDisplayComponents(
            new TextDisplayBuilder().setContent(
                "Attribuer un palier : `setperm <1-3> @rôle` — le retirer : `delperm <1-3> @rôle`.\n" +
                    "Voir qui possède quel palier : `helpall`."
            )
        );

        await ctx.send({ flags: MessageFlags.IsComponentsV2, components: [container] });
    },
};
