const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  UserSelectMenuBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
} = require("discord.js");

// Rendu commun à toutes les cartes "liste" du bot (owners, whitelist, bots,
// admins, boosters, membres d'un rôle...) : même en-tête, même pagination,
// mêmes menus d'ajout/retrait. Extrait de utils/serverAdminCommands.js pour
// que les listes en LECTURE SEULE (utils/readOnlyLists.js) partagent
// exactement la même présentation au lieu d'en réinventer une deuxième.
//
// Ajout/retrait : les deux mêmes UserSelectMenu qu'utils/configPanel.js::
// accessRows() — un pour ajouter, un pour retirer — plutôt que le menu
// combiné du CrowBot : plus simple à maintenir, un seul aller-retour par
// action.

const ID = "srv";
const PAGE_SIZE = 10;

function card(title, body, rows = []) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}`));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(body || "*Aucune entrée.*"));
  for (const row of rows) container.addActionRowComponents(row);
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function paginate(items, page) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const clamped = Math.min(Math.max(0, page), totalPages - 1);
  return { slice: items.slice(clamped * PAGE_SIZE, clamped * PAGE_SIZE + PAGE_SIZE), page: clamped, totalPages };
}

/**
 * `idKind` peut porter un argument après un "/" (ex : "rolemembers/1234") :
 * il voyage dans le customId pour que la pagination sache, au clic, DE
 * QUELLE liste on parle — aucune session à garder en mémoire côté bot, la
 * carte reste utilisable même après un redémarrage.
 */
function buildListCard({ idKind, title, description, items, page, canEdit }) {
  const { slice, page: clampedPage, totalPages } = paginate(items, page);
  const lines = slice.map((item, i) => `${clampedPage * PAGE_SIZE + i + 1}. ${item}`);
  const body = [description, `Nombre actuel : ${items.length}`, "", ...lines].join("\n");

  const rows = [];
  if (totalPages > 1) {
    const options = [];
    if (clampedPage > 0) options.push(new StringSelectMenuOptionBuilder().setLabel("Page précédente").setValue(String(clampedPage - 1)));
    if (clampedPage < totalPages - 1) options.push(new StringSelectMenuOptionBuilder().setLabel("Page suivante").setValue(String(clampedPage + 1)));
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${ID}:page:${idKind}`)
          .setPlaceholder(`Page ${clampedPage + 1}/${totalPages}`)
          .addOptions(options)
      )
    );
  }
  if (canEdit) {
    rows.push(
      new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${ID}:add:${idKind}`).setPlaceholder("Ajouter"))
    );
    rows.push(
      new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId(`${ID}:del:${idKind}`).setPlaceholder("Retirer"))
    );
  }
  return card(title, body, rows);
}

module.exports = { ID, PAGE_SIZE, card, paginate, buildListCard };
