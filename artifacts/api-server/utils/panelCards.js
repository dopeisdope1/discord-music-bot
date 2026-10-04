const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} = require("discord.js");

// Gabarit de rendu commun pour la navigation hiérarchique des panels (&panel,
// =panel, !!config) : des "cartes" titre + description + bouton, empilées et
// séparées par un trait, exactement le style demandé (capture de référence
// "elyra") — un seul endroit qui sait dessiner ça, pour ne pas le
// réimplémenter à la main dans chaque rubrique des 3 bots.
//
// Une carte :
//   { title: "Anti-nuke", description: "Interrupteur, sanctions...",
//     customId: "cfg:navopen:antinuke", label: "Choisir...", disabled: false }
// Rendu : "**title**\ndescription" en TextDisplay, puis un ActionRow à un
// bouton. Les cartes sont séparées par un SeparatorBuilder (Small).
//
// addCards(container, cards) ajoute une liste de cartes au container.
function addCards(container, cards) {
  cards.forEach((card, i) => {
    if (i > 0) container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    const lignes = [`**${card.title}**`];
    if (card.description) lignes.push(card.description);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lignes.join("\n")));
    if (card.customId) {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(card.customId)
            .setLabel(card.label || "Choisir...")
            .setStyle(card.style || ButtonStyle.Secondary)
            .setDisabled(Boolean(card.disabled))
        )
      );
    }
  });
}

/** Bouton "◀ Retour" — même customId partout pour qu'un seul handler le gère par section. */
function addBackButton(container, customId, label = "◀ Retour") {
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(ButtonStyle.Secondary))
  );
}

/** Pagination ◀/▶ façon "Page X/Y" — mêmes customId que le reste du panel (préfixe fourni par l'appelant). */
function addPager(container, { page, pages, prevId, nextId }) {
  if (pages <= 1) return;
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(prevId).setLabel("◀ Précédent").setStyle(ButtonStyle.Secondary).setDisabled(page === 0),
      new ButtonBuilder().setCustomId(nextId).setLabel(`Page ${page + 1}/${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1)
    )
  );
}

module.exports = { addCards, addBackButton, addPager };
