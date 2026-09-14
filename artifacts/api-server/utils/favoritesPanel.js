const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} = require("discord.js");
const favoritesStore = require("./favoritesStore");
const { formatDuration } = require("./nowPlayingPanel");

const SELECT_ID = "music_favplay";

const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Playlist des favoris d'une personne, en Components V2 (même style que le
 * panel de lecture : pas de couleur d'accent). Renvoie `null` si la personne
 * n'a encore rien mis en favori, au choix de l'appelant d'afficher un message.
 * @param {string} userId
 * @param {string} prefix — préfixe musique du serveur, pour l'aide affichée
 */
function buildFavoritesPanel(userId, prefix) {
  const favorites = favoritesStore.list(userId);
  if (!favorites.length) return null;

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `## Tes favoris\n${favorites.length} titre(s) — choisis-en un ci-dessous pour le lancer.`
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      favorites
        .map((f, i) => {
          const duration = f.length ? ` \`${formatDuration(Math.floor(f.length / 1000))}\`` : "";
          return `**${i + 1}.** [${truncate(f.title, 60)}](${f.uri})${duration}`;
        })
        .join("\n")
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  // La valeur d'option est l'INDEX et non l'URI : une URI Spotify dépasse
  // parfois les 100 caractères autorisés pour une valeur de menu.
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(SELECT_ID)
        .setPlaceholder("Choisis un titre à jouer")
        .addOptions(
          favorites.map((f, i) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(truncate(f.title, 100))
              .setDescription(truncate(f.author || "Source inconnue", 100))
              .setValue(String(i))
          )
        )
    )
  );

  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `Ajoute un favori avec le bouton **Favori** du panel de lecture, ou joue un titre précis avec \`${prefix}play <titre>\`.`
    )
  );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

module.exports = { buildFavoritesPanel, SELECT_ID };
