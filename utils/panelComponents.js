const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageFlags,
} = require("discord.js");

// Carte Components V2 générique (même style que `.panel`/`.help`/les logs de
// ce bot : pas de couleur d'accent, `##` titre, séparateur fin). `thumbnail`
// place une petite image à côté du titre (via une Section), `image` ajoute
// une image pleine largeur en bas (via une MediaGallery).
function buildCard({ title, description, fields = [], thumbnail, image }) {
  const container = new ContainerBuilder();

  // Confirmation d'une seule ligne (lock, ban, blacklist...) : ni titre en
  // "##" ni séparateur, sinon le bloc occupe trois fois la place de son
  // contenu. Donne le même rendu compact que l'embed de `&clear`. Dès qu'il y
  // a autre chose qu'un titre, on retombe sur la mise en page complète.
  if (!description && !fields.length && !thumbnail && !image) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(title));
    return container;
  }

  const titleText = new TextDisplayBuilder().setContent(`## ${title}`);

  if (thumbnail) {
    const section = new SectionBuilder()
      .addTextDisplayComponents(titleText)
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnail));
    if (description) section.addTextDisplayComponents(new TextDisplayBuilder().setContent(description));
    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(titleText);
    if (description) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(description));
  }

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  if (fields.length) {
    // Style de l'ancien &panel de ce bot : citation ">" plutôt que label en gras.
    const lines = fields.map((f) => `> ${f.name} : ${f.value}`);
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join("\n")));
  }

  if (image) {
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(image)));
  }

  return container;
}

function appendText(container, content) {
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(content));
  return container;
}

// Liste en arbre : "**label**\n└ value" séparés par une ligne vide — pour
// `&perms` (rôles/membres par permission) et `&helpall` (commandes par permission).
function buildTreeList(entries, { empty = "Aucune." } = {}) {
  if (!entries.length) return empty;
  return entries.map(([label, value]) => `**${label}**\n└ ${value}`).join("\n\n");
}

function buildSelect(customId, placeholder, options, { min = 1, max = 1 } = {}) {
  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .setMinValues(min)
    .setMaxValues(max)
    .addOptions(
      options.map((opt) => {
        const built = new StringSelectMenuOptionBuilder()
          .setLabel(opt.label)
          .setValue(opt.value)
          .setDefault(Boolean(opt.default));
        if (opt.description) built.setDescription(opt.description);
        return built;
      })
    );
}

function actionRow(component) {
  return new ActionRowBuilder().addComponents(component);
}

// Barre de navigation persistante par boutons — même principe que l'ancien
// &panel de ce bot (buildNavRow) : un bouton par rubrique, celle affichée en
// Primary + désactivée, les autres en Secondary. 8 rubriques ne tiennent pas
// dans une seule ActionRow (max 5 boutons) donc on répartit sur 2 lignes.
function buildNavButtons(rubriques, currentKey, { customIdPrefix = "modpanel:navto" } = {}) {
  const buttons = rubriques.map((r) =>
    new ButtonBuilder()
      .setCustomId(`${customIdPrefix}:${r.key}`)
      .setLabel(r.label)
      .setStyle(r.key === currentKey ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(r.key === currentKey)
  );

  const rows = [];
  for (let i = 0; i < buttons.length; i += 4) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 4)));
  }
  return rows;
}

function payload(container) {
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

module.exports = { buildCard, buildTreeList, appendText, buildSelect, actionRow, buildNavButtons, payload };
