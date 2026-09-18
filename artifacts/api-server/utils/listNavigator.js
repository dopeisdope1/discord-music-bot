const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");
const messageOwner = require("./messageOwner");

// Composant générique pour toute commande "liste" (&bmutelist, &zinkillerlist,
// &banlist, &mutelist...) : UN message, paginé avec Précédent/Suivant plutôt
// que tronqué en silence ("...et 12 autre(s)") ou dumpé sans limite au risque
// de dépasser le plafond de texte Discord. Même patron que utils/
// helpNavigator.js, en plus simple (pas de paliers à choisir, juste des pages).
const CUSTOM_ID = "listnav";

// Chaque commande enregistre comment reconstruire SES données à jour au
// moment du clic (le rôle peut avoir changé, un membre peut avoir été
// démute entre l'envoi et le clic) — jamais de snapshot figé dans le
// customId. Reçoit l'objet Guild directement (message.guild à l'envoi,
// interaction.guild au clic) : les deux le fournissent déjà, pas besoin de
// remonter par client.guilds.cache.
const PROVIDERS = new Map();

/**
 * @param {string} kind identifiant unique de la liste (ex: "bmutelist")
 * @param {(guild: import('discord.js').Guild) => { title: string, lines: string[], vide?: string }} fournisseur
 */
function registerProvider(kind, fournisseur) {
  PROVIDERS.set(kind, fournisseur);
}

const LIMITE_PAGE = 3400;

function paginerLignes(lignes) {
  const pages = [];
  let courante = [];
  let longueur = 0;
  for (const ligne of lignes) {
    const ajout = ligne.length + 1;
    if (courante.length && longueur + ajout > LIMITE_PAGE) {
      pages.push(courante);
      courante = [];
      longueur = 0;
    }
    courante.push(ligne);
    longueur += ajout;
  }
  if (courante.length) pages.push(courante);
  return pages.length ? pages : [[]];
}

async function buildListNavigator(kind, guild, page = 0) {
  const fournisseur = PROVIDERS.get(kind);
  const { title, lines, vide, erreur, compteur } = await fournisseur(guild);
  const container = new ContainerBuilder();

  if (erreur) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${erreur}`));
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

  if (!lines.length) {
    const compteurVide = compteur ? `${compteur}\n` : "";
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}\n${compteurVide}${vide || "Aucune entrée."}`));
    return { flags: MessageFlags.IsComponentsV2, components: [container] };
  }

  const pages = paginerLignes(lines);
  const pageActive = Math.min(Math.max(page, 0), pages.length - 1);
  const suffixe = pages.length > 1 ? ` (${pageActive + 1}/${pages.length})` : "";
  // `compteur` laisse une commande garder sa propre formulation ("N fiche(s)
  // active(s)") ; sans lui, le nombre de lignes affichées suffit ("— N").
  const enTete = compteur ? `## ${title}${suffixe}\n${compteur}` : `## ${title} — ${lines.length}${suffixe}`;
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${enTete}\n${pages[pageActive].join("\n")}`));

  if (pages.length > 1) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_ID}:${kind}:${pageActive - 1}`)
          .setLabel("Précédent")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pageActive === 0),
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_ID}:${kind}:${pageActive + 1}`)
          .setLabel("Suivant")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(pageActive === pages.length - 1)
      )
    );
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** Poste la liste navigable et en retient le propriétaire (voir utils/messageOwner.js). */
async function repondreAvecListe(kind, message) {
  return messageOwner.repondreEtRetenir(message, await buildListNavigator(kind, message.guild, 0));
}

async function handleListNavInteraction(interaction) {
  const [, kind, page] = interaction.customId.split(":");
  if (!PROVIDERS.has(kind)) return;
  return interaction.update(await buildListNavigator(kind, interaction.guild, Number(page)));
}

module.exports = { CUSTOM_ID, registerProvider, buildListNavigator, repondreAvecListe, handleListNavInteraction };
