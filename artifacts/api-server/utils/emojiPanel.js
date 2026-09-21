const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  MessageFlags,
} = require("discord.js");
const { can } = require("./permissions/engine");
const { SLOTS, emojiDe } = require("./emojiSlots");
const categoryEmojiStore = require("./categoryEmojiStore");
const messageOwner = require("./messageOwner");

// "&emoji" — personnalise l'emoji de chaque GROUPE affiché dans l'aide (voir
// utils/emojiSlots.js pour la liste des slots, utils/helpNavigator.js pour
// leur affichage). Réservé au rang sys (comme &sys/&panel > paramètres du
// bot) : c'est un réglage global du serveur, pas une permission ordinaire.
const CUSTOM_ID = "emoji";
const PERMISSION = "sys";

/**
 * Un emoji Discord (unicode, custom `<a:nom:id>`/`<:nom:id>`, ou juste
 * `:nom:` — voir ci-dessous) — une seule "unité" visuelle, pas une phrase.
 * @param {string} texte
 * @param {import('discord.js').Guild} [guild] pour résoudre `:nom:` contre
 *   les emojis DU SERVEUR — sur mobile, `\` (qui révèle le code `<:nom:id>`
 *   sur desktop) n'a pas d'équivalent, donc on accepte le raccourci court.
 */
function emojiValide(texte, guild) {
  const t = texte.trim();
  if (/^<a?:\w+:\d+>$/.test(t)) return t;
  // ":nom:" (sans les chevrons ni l'ID, ce que le picker mobile insère) —
  // recherche par nom dans les emojis du serveur, insensible à la casse.
  // Pas de \w strict : Discord tolère des noms d'émojis avec des caractères
  // hors \w (ex. "voice_channel~1", vu en pratique) — on se contente
  // d'exclure ":" pour distinguer la fin du nom.
  const nomCourt = /^:([^:]+):$/.exec(t);
  if (nomCourt && guild) {
    const trouve = guild.emojis.cache.find((e) => e.name?.toLowerCase() === nomCourt[1].toLowerCase());
    if (trouve) return trouve.toString();
    return null;
  }
  // Unicode : accepte 1 à quelques points de code (emoji composés avec
  // variation selector/ZWJ, ex: ❤️, 🧑‍💻) sans valider caractère par
  // caractère — juste une longueur raisonnable pour écarter une phrase.
  if (t.length && t.length <= 8 && !/[a-zA-Z0-9]/.test(t)) return t;
  return null;
}

// Discord limite un StringSelectMenu à 25 options — dépassé depuis l'ajout
// des slots "icon:*" (12 slots d'aide + 27 icônes de design = 39 au total).
// Solution : un premier select CHOISIT LA CATÉGORIE (8 au total, `s.categorie`
// posé par utils/emojiSlots.js), un second liste seulement les slots de
// cette catégorie (8 au plus dans le plus gros groupe) — jamais les deux
// mélangés dans une pagination linéaire, moins lisible ici.
function categoriesDe() {
  const vues = [];
  for (const s of SLOTS) if (!vues.includes(s.categorie)) vues.push(s.categorie);
  return vues;
}

function buildEmojiPanel(guildId, slotKey, categorieForcee = null) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("## Emoji\nChoisis une catégorie, puis l'élément dont tu veux changer l'emoji (groupe d'aide ou icône du design).")
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  const slot = SLOTS.find((s) => s.key === slotKey) || null;
  const categorie = slot?.categorie || categorieForcee;

  if (slot) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(`**${slot.label}**\nEmoji actuel : ${emojiDe(guildId, slot.key)}`)
    );
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${CUSTOM_ID}:changebtn:${slotKey}`).setLabel("Changer").setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`${CUSTOM_ID}:reset:${slotKey}`)
          .setLabel("Réinitialiser")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(!categoryEmojiStore.get(guildId, slotKey))
      )
    );
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  }

  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${CUSTOM_ID}:selectcat`)
        .setPlaceholder("Choisis une catégorie")
        .addOptions(
          categoriesDe().map((c) => new StringSelectMenuOptionBuilder().setLabel(c.slice(0, 100)).setValue(c).setDefault(c === categorie))
        )
    )
  );

  if (categorie) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${CUSTOM_ID}:select`)
          .setPlaceholder("Choisis l'emoji à changer")
          .addOptions(
            SLOTS.filter((s) => s.categorie === categorie).map((s) =>
              new StringSelectMenuOptionBuilder().setLabel(s.label.slice(0, 100)).setValue(s.key).setDefault(s.key === slotKey)
            )
          )
      )
    );
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildEmojiListCard(guildId) {
  const overrides = categoryEmojiStore.list(guildId);
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Emojis personnalisés"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  const lignes = SLOTS.filter((s) => overrides[s.key]).map((s) => `${overrides[s.key]} **${s.label}** *(défaut : ${s.defaultEmoji})*`);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(lignes.length ? lignes.join("\n") : "*Aucun emoji personnalisé — tout est par défaut.*")
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

async function handleEmojiTextCommand(client, message, args) {
  if (!can(message.member, PERMISSION)) return;
  const sub = (args[0] || "").toLowerCase();

  if (sub === "list") {
    return message.reply(buildEmojiListCard(message.guild.id));
  }
  const trouverSlot = (motif) =>
    SLOTS.find((s) => s.key === motif || s.key.split(":")[1]?.toLowerCase() === motif.toLowerCase() || s.label.toLowerCase().includes(motif.toLowerCase()));

  if (sub === "reset") {
    const slot = trouverSlot(args[1] || "");
    if (!slot) return message.reply({ content: "Slot introuvable — utilise `&emoji` pour voir la liste.", flags: MessageFlags.Ephemeral }).catch(() => {});
    categoryEmojiStore.reset(message.guild.id, slot.key);
    return message.reply(`✅ **${slot.label}** remis à son emoji par défaut (${slot.defaultEmoji}).`);
  }

  // Raccourci direct "&emoji <clé> <emoji>" — change l'emoji d'un coup,
  // sans passer par le panel/la modale (demande explicite, calquée sur
  // "&emoji owner 👑" d'un autre bot).
  if (sub && sub !== "list") {
    const slot = trouverSlot(sub);
    if (!slot) {
      return message.reply("Utilisation : `&emoji` pour ouvrir le panel, `&emoji <clé> <emoji>`, ou `&emoji reset <clé>`.");
    }
    const emoji = emojiValide(args.slice(1).join(" "), message.guild);
    if (!emoji) {
      return message.reply(
        "Ça ne ressemble pas à un seul emoji — `&emoji <clé> <emoji>`.\n" +
          "Pour un emoji personnalisé DE CE SERVEUR : `:nom:` suffit (ex. `:voice_channel~1:`), ou choisis-le dans le menu qui s'affiche quand tu tapes `:`. Pour un emoji d'un AUTRE serveur, il faut son code complet `<:nom:id>`."
      );
    }
    categoryEmojiStore.set(message.guild.id, slot.key, emoji);
    return message.reply(`✅ Emoji mis à jour\n${emoji} \`${slot.key.split(":")[1] || slot.key}\` — ${slot.label}`);
  }

  return messageOwner.repondreEtRetenir(message, buildEmojiPanel(message.guild.id, null));
}

async function handleEmojiInteraction(interaction) {
  if (!can(interaction.member, PERMISSION)) {
    return interaction.reply({ content: "Réservé au rang sys.", flags: MessageFlags.Ephemeral });
  }
  // Les clés de slot contiennent elles-mêmes un ":" ("cat:moderation",
  // "sec:Autres"...) : on ne prend QUE le premier segment comme action,
  // tout le reste reforme la clé complète — un split naïf en 3 la
  // tronquerait ("cat" au lieu de "cat:moderation").
  const [, action, ...resteCle] = interaction.customId.split(":");
  const slotKey = resteCle.join(":");

  if (action === "selectcat") {
    return interaction.update(buildEmojiPanel(interaction.guild.id, null, interaction.values[0]));
  }

  if (action === "select") {
    return interaction.update(buildEmojiPanel(interaction.guild.id, interaction.values[0]));
  }

  if (action === "reset") {
    categoryEmojiStore.reset(interaction.guild.id, slotKey);
    return interaction.update(buildEmojiPanel(interaction.guild.id, slotKey));
  }

  if (action === "changebtn") {
    const modal = new ModalBuilder().setCustomId(`${CUSTOM_ID}:changesubmit:${slotKey}`).setTitle("Nouvel emoji");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("emoji")
          .setLabel("Emoji (unicode, :nom: ou <:nom:id>)")
          .setPlaceholder("🛡️ ou :voice_channel~1:")
          .setStyle(TextInputStyle.Short)
          .setMaxLength(40)
          .setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "changesubmit" && interaction.isModalSubmit()) {
    const saisi = interaction.fields.getTextInputValue("emoji");
    const emoji = emojiValide(saisi, interaction.guild);
    if (!emoji) {
      // Erreur fréquente : taper juste le nom SANS les ":" ("voice_channel~1"
      // au lieu de ":voice_channel~1:") — la modale ne propose pas
      // l'auto-complétion d'un vrai champ de message Discord.
      return interaction.reply({
        content:
          "Ça ne ressemble pas à un seul emoji — réessaie.\n" +
          "Pour un emoji personnalisé DE CE SERVEUR, entoure son nom de deux-points : `:voice_channel~1:`. Pour un emoji d'un AUTRE serveur, il faut son code complet `<:nom:id>` (tape `\\` suivi de l'emoji dans un salon, sur ordinateur, pour l'obtenir).",
        flags: MessageFlags.Ephemeral,
      });
    }
    categoryEmojiStore.set(interaction.guild.id, slotKey, emoji);
    return interaction.update(buildEmojiPanel(interaction.guild.id, slotKey));
  }
}

module.exports = { CUSTOM_ID, buildEmojiPanel, handleEmojiTextCommand, handleEmojiInteraction };
