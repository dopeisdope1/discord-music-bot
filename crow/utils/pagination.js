"use strict";

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");

async function paginate(message, pages, { time = 120_000 } = {}) {
    if (pages.length <= 1) {
        return message.reply({ embeds: [pages[0]] });
    }

    let index = 0;
    const buildRow = () =>
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("page:prev")
                .setLabel("◀")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(index === 0),
            new ButtonBuilder()
                .setCustomId("page:next")
                .setLabel("▶")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(index === pages.length - 1)
        );

    const sent = await message.reply({ embeds: [pages[index]], components: [buildRow()] });

    const collector = sent.createMessageComponentCollector({
        time,
        filter: (i) => i.user.id === message.author.id,
    });

    collector.on("collect", async (interaction) => {
        if (interaction.customId === "page:prev") index = Math.max(0, index - 1);
        if (interaction.customId === "page:next") index = Math.min(pages.length - 1, index + 1);
        await interaction.update({ embeds: [pages[index]], components: [buildRow()] });
    });

    collector.on("end", () => sent.edit({ components: [] }).catch(() => {}));

    return sent;
}

module.exports = { paginate };
