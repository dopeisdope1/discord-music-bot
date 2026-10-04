const {
  PermissionFlagsBits,
  ContainerBuilder,
  SectionBuilder,
  ThumbnailBuilder,
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
const { checkHierarchy, checkHierarchyById, checkBotPermission, report } = require("./moderation/actions");
const { formatDuration } = require("./moderationCommands");
const zinkillerStore = require("./zinkillerStore");
const banReasonsStore = require("./banReasonsStore");
const altLinksStore = require("./altLinksStore");
const messageOwner = require("./messageOwner");

// "-zinkiller <@membre|id>" — carte "Blacklist" en plusieurs étapes
// (référence fournie) : "raisons" (choisir une raison PRÉDÉFINIE avec son
// grade éventuel, ou personnalisée, une durée, un double compte) ->
// "preuves" (SI la raison choisie l'exige, utils/banReasonsStore.js::
// requiresProof — bloque tant qu'aucune preuve n'est fournie) ->
// "confirmation" (récap + note libre optionnelle) -> exécution (utils/
// zinkillerStore.js, persistant comme avant). Remplace l'ancien flux par
// tokens texte (raisonid:/preuve:/grade:/duree:) — gardait la même logique
// métier, juste sans l'UX carte demandée.
//
// Travaille sur un discord.js User (jamais GuildMember) de bout en bout :
// la cible peut ne PAS être sur le serveur (blacklist préventive avant
// qu'elle rejoigne, comme un ban Discord normal par ID) — guild.members.ban
// accepte un ID seul, contrairement à member.ban(). La hiérarchie se
// vérifie sur le membre s'il existe (checkHierarchy), sinon sur l'ID seul
// (checkHierarchyById, sans comparaison de rôle possible).
const CUSTOM_ID = "blcard";
const PERMISSION = "moderation.zinkiller";

const etats = new Map();
const TTL_MS = 60 * 60 * 1000;

function purger() {
  const maintenant = Date.now();
  for (const [id, e] of etats) if (maintenant - e.at > TTL_MS) etats.delete(id);
}

const DUREES = [
  { id: "perm", label: "Permanente", ms: null },
  { id: "1h", label: "1 heure", ms: 3_600_000 },
  { id: "6h", label: "6 heures", ms: 21_600_000 },
  { id: "1j", label: "1 jour", ms: 86_400_000 },
  { id: "3j", label: "3 jours", ms: 3 * 86_400_000 },
  { id: "7j", label: "7 jours", ms: 7 * 86_400_000 },
  { id: "30j", label: "30 jours", ms: 30 * 86_400_000 },
];

const AUCUN_LIEN = "aucun";

function candidatsDoubleCompte(guild, targetId) {
  return zinkillerStore.list(guild.id).filter((e) => e.userId !== targetId);
}

function etatVide(targetId) {
  return {
    targetId,
    reasonId: null,
    reasonLabel: null,
    reasonGrade: null,
    reasonRequiresProof: false,
    dureeId: null,
    linkedToId: null,
    preuve: null,
    note: null,
    etape: "raisons",
    at: Date.now(),
  };
}

/** Section avec l'avatar de la cible en vignette à droite (référence fournie) — factorisé, les 3 cartes l'utilisent. */
function sectionAvecAvatar(target, lignes) {
  return new SectionBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lignes.join("\n")))
    .setThumbnailAccessory(new ThumbnailBuilder().setURL(target.displayAvatarURL({ extension: "png", size: 256 })));
}

function buildRaisonsCard(guild, target, etat) {
  const raisons = banReasonsStore.list(guild.id);
  const dureeChoisie = DUREES.find((d) => d.id === etat.dureeId)?.label || "à choisir";
  const candidats = candidatsDoubleCompte(guild, target.id);
  const doubleCompteChoisi = etat.linkedToId ? `<@${etat.linkedToId}>` : "aucun";

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Blacklist · raisons"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addSectionComponents(
    sectionAvecAvatar(target, [
      `**Cible** : ${target} — \`${target.id}\``,
      `**Pseudo** : ${target.tag || target.username || target.id}`,
      `**Grade** : ${etat.reasonGrade || "—"}`,
      `**Durée** : ${dureeChoisie}`,
      "",
      `**Raison sélectionnée** : ${etat.reasonLabel || "aucune"}`,
      `**Double compte de** : ${doubleCompteChoisi}`,
    ])
  );

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  const optionsRaisons = [
    ...raisons.map((r) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(r.label.slice(0, 100))
        .setDescription([r.grade ? `grade ${r.grade}` : null, r.requiresProof ? "preuve obligatoire" : null].filter(Boolean).join(" · ").slice(0, 100) || undefined)
        .setValue(r.id)
        .setDefault(etat.reasonId === r.id)
    ),
    new StringSelectMenuOptionBuilder().setLabel("Raison personnalisée…").setValue("custom").setDefault(etat.reasonId === "custom"),
  ];
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`${CUSTOM_ID}:reason:${target.id}`).setPlaceholder("Choisis une raison").addOptions(optionsRaisons)
    )
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${CUSTOM_ID}:duree:${target.id}`)
        .setPlaceholder("Choisis la durée")
        .addOptions(DUREES.map((d) => new StringSelectMenuOptionBuilder().setLabel(d.label).setValue(d.id).setDefault(etat.dureeId === d.id)))
    )
  );
  if (candidats.length) {
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${CUSTOM_ID}:lien:${target.id}`)
          .setPlaceholder("Double compte de…")
          .addOptions(
            new StringSelectMenuOptionBuilder()
              .setLabel("Aucun — compte principal")
              .setDescription("Ce compte n'est le double de personne")
              .setValue(AUCUN_LIEN)
              .setDefault(!etat.linkedToId),
            ...candidats.slice(0, 24).map((e) => {
              const tag = guild.members.cache.get(e.userId)?.user?.tag;
              return new StringSelectMenuOptionBuilder()
                .setLabel((tag || e.userId).slice(0, 100))
                .setDescription((e.reason || "Aucune raison enregistrée").slice(0, 100))
                .setValue(e.userId)
                .setDefault(etat.linkedToId === e.userId);
            })
          )
      )
    );
  }
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:go:${target.id}`).setLabel("Confirmer").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:no:${target.id}`).setLabel("Annuler").setStyle(ButtonStyle.Secondary)
    )
  );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildPreuvesCard(guild, target, etat) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Blacklist · preuves"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addSectionComponents(
    sectionAvecAvatar(target, [
      `**Cible** : ${target} — \`${target.id}\``,
      `**Raison** : ${etat.reasonLabel}`,
      `**État** : ${etat.preuve ? `✅ preuve reçue` : "❌ aucune preuve reçue"}`,
    ])
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent("**Actions** : ajoute les éléments obligatoires pour cette raison.")
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`${CUSTOM_ID}:media:${target.id}`).setLabel("Média").setStyle(ButtonStyle.Secondary))
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:back:${target.id}`).setLabel("Retour").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:no:${target.id}`).setLabel("Annuler").setStyle(ButtonStyle.Danger)
    )
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildConfirmationCard(guild, target, etat) {
  const dureeChoisie = DUREES.find((d) => d.id === etat.dureeId)?.label || "Permanente";
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Blacklist · confirmation"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addSectionComponents(
    sectionAvecAvatar(
      target,
      [
        `**Cible** : ${target} — \`${target.id}\``,
        `**Raison** : ${etat.reasonLabel}`,
        `**Durée** : ${dureeChoisie}`,
        etat.note ? `**Texte** : ${etat.note}` : null,
        `**Preuve** : ${etat.reasonRequiresProof ? (etat.preuve ? `✅ ${etat.preuve}` : "❌ facultative") : "❌ facultative"}`,
        `**Double compte de** : ${etat.linkedToId ? `<@${etat.linkedToId}>` : "aucun"}`,
      ].filter(Boolean)
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:dureeback:${target.id}`).setLabel("Durée").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:texte:${target.id}`).setLabel("Texte").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:confirm:${target.id}`).setLabel("Confirmer").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`${CUSTOM_ID}:no:${target.id}`).setLabel("Annuler").setStyle(ButtonStyle.Danger)
    )
  );
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

function buildCard(guild, target, etat) {
  if (etat.etape === "preuves") return buildPreuvesCard(guild, target, etat);
  if (etat.etape === "confirmation") return buildConfirmationCard(guild, target, etat);
  return buildRaisonsCard(guild, target, etat);
}

async function repondreAvecBlacklistCard(message, target) {
  const etat = etatVide(target.id);
  const envoye = await messageOwner.repondreEtRetenir(message, buildRaisonsCard(message.guild, target, etat));
  if (envoye?.id) etats.set(envoye.id, etat);
  purger();
  return envoye;
}

async function handleBlacklistCardInteraction(interaction) {
  const [, action, targetId, extra] = interaction.customId.split(":");
  if (!can(interaction.member, PERMISSION)) {
    return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
  }

  const messageId = interaction.message?.id;
  const etat = etats.get(messageId) || etatVide(targetId);

  const target = await interaction.client.users.fetch(etat.targetId).catch(() => null);
  if (!target) return interaction.reply({ content: "Identifiant Discord introuvable.", flags: MessageFlags.Ephemeral });

  if (action === "no") {
    etats.delete(messageId);
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Blacklist\n*Annulé.*"));
    return interaction.update({ flags: MessageFlags.IsComponentsV2, components: [container] });
  }

  if (action === "reason" && interaction.values[0] === "custom") {
    const modal = new ModalBuilder().setCustomId(`${CUSTOM_ID}:reasoncustom:${target.id}`).setTitle("Raison personnalisée");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("raison").setLabel("Raison").setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(true)
      )
    );
    return interaction.showModal(modal);
  }

  if (action === "reasoncustom" && interaction.isModalSubmit()) {
    etat.reasonId = "custom";
    etat.reasonLabel = interaction.fields.getTextInputValue("raison").trim();
    etat.reasonGrade = null;
    etat.reasonRequiresProof = false;
  } else if (action === "reason") {
    const choisie = banReasonsStore.get(interaction.guild.id, interaction.values[0]);
    etat.reasonId = interaction.values[0];
    etat.reasonLabel = choisie?.label || null;
    etat.reasonGrade = choisie?.grade || null;
    etat.reasonRequiresProof = Boolean(choisie?.requiresProof);
  } else if (action === "duree") {
    etat.dureeId = interaction.values[0];
  } else if (action === "dureeback") {
    etat.etape = "raisons";
    etats.set(messageId, etat);
    return interaction.update(buildCard(interaction.guild, target, etat));
  } else if (action === "lien") {
    etat.linkedToId = interaction.values[0] === AUCUN_LIEN ? null : interaction.values[0];
  } else if (action === "back") {
    etat.etape = "raisons";
    etats.set(messageId, etat);
    return interaction.update(buildCard(interaction.guild, target, etat));
  } else if (action === "media") {
    const modal = new ModalBuilder().setCustomId(`${CUSTOM_ID}:mediasubmit:${target.id}`).setTitle("Ajouter une preuve");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("preuve").setLabel("Lien ou description de la preuve").setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(true)
      )
    );
    return interaction.showModal(modal);
  } else if (action === "mediasubmit" && interaction.isModalSubmit()) {
    etat.preuve = interaction.fields.getTextInputValue("preuve").trim();
    etat.etape = "confirmation";
    etats.set(messageId, etat);
    await interaction.reply({ content: "Preuve enregistrée.", flags: MessageFlags.Ephemeral });
    return interaction.message?.edit(buildCard(interaction.guild, target, etat)).catch(() => {});
  } else if (action === "texte") {
    const modal = new ModalBuilder().setCustomId(`${CUSTOM_ID}:textesubmit:${target.id}`).setTitle("Note libre (optionnelle)");
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("texte")
          .setLabel("Texte")
          .setStyle(TextInputStyle.Paragraph)
          .setMaxLength(300)
          .setRequired(false)
          .setValue(etat.note || "")
      )
    );
    return interaction.showModal(modal);
  } else if (action === "textesubmit" && interaction.isModalSubmit()) {
    etat.note = interaction.fields.getTextInputValue("texte").trim() || null;
    etats.set(messageId, etat);
    return interaction.update(buildCard(interaction.guild, target, etat));
  }

  if (action === "go") {
    if (!etat.reasonLabel) return interaction.reply({ content: "Choisis une raison d'abord.", flags: MessageFlags.Ephemeral });
    if (!etat.dureeId) return interaction.reply({ content: "Choisis une durée d'abord.", flags: MessageFlags.Ephemeral });

    etat.etape = etat.reasonRequiresProof && !etat.preuve ? "preuves" : "confirmation";
    etats.set(messageId, etat);
    return interaction.update(buildCard(interaction.guild, target, etat));
  }

  if (action === "confirm") {
    if (etat.reasonRequiresProof && !etat.preuve) {
      etat.etape = "preuves";
      etats.set(messageId, etat);
      return interaction.update(buildCard(interaction.guild, target, etat));
    }

    const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
    const refusal = targetMember
      ? checkHierarchy(interaction.guild, interaction.member, targetMember)
      : checkHierarchyById(interaction.guild, interaction.member, target.id);
    if (refusal) return interaction.reply({ content: refusal, flags: MessageFlags.Ephemeral });
    const botPerm = checkBotPermission(interaction.guild, PermissionFlagsBits.BanMembers, "BanMembers");
    if (botPerm) return interaction.reply({ content: botPerm, flags: MessageFlags.Ephemeral });

    const duree = DUREES.find((d) => d.id === etat.dureeId);
    const tag = target.tag;
    try {
      await interaction.guild.members.ban(target.id, { reason: `${etat.reasonLabel} — par ${interaction.user.tag}` });
    } catch (err) {
      return interaction.reply({ content: `Discord a refusé : ${err.message}`, flags: MessageFlags.Ephemeral });
    }

    const expiresAt = duree.ms ? Date.now() + duree.ms : null;
    zinkillerStore.add(interaction.guild.id, target.id, {
      reason: etat.reasonLabel,
      moderatorId: interaction.user.id,
      preuve: etat.preuve,
      grade: etat.reasonGrade,
      note: etat.note,
      expiresAt,
    });
    if (etat.linkedToId) altLinksStore.link(interaction.guild.id, target.id, etat.linkedToId);

    await report(interaction.client, {
      guildId: interaction.guild.id,
      title: "Blacklist mise à jour",
      fields: [
        { label: "Cible", value: `<@${target.id}> (${target.id})` },
        { label: "Durée", value: duree.ms ? formatDuration(duree.ms) : "Permanente" },
        ...(etat.reasonGrade ? [{ label: "Grade", value: etat.reasonGrade }] : []),
        ...(etat.preuve ? [{ label: "Preuve", value: etat.preuve }] : []),
        ...(etat.note ? [{ label: "Texte", value: etat.note }] : []),
        ...(etat.linkedToId ? [{ label: "Double compte de", value: `<@${etat.linkedToId}>` }] : []),
      ],
      action: duree.ms ? "zinkiller" : "zinkiller",
      targetId: target.id,
      targetTag: tag,
      moderator: interaction.user,
      reason: etat.reasonLabel,
      channelId: interaction.channelId,
    });

    etats.delete(messageId);
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Blacklist\n**${tag}** banni ${duree.ms ? `pour ${formatDuration(duree.ms)}` : "définitivement"}.\nRaison : ${etat.reasonLabel}${etat.linkedToId ? `\nDouble compte de : <@${etat.linkedToId}>` : ""}`
      )
    );
    return interaction.update({ flags: MessageFlags.IsComponentsV2, components: [container] });
  }

  etats.set(messageId, etat);
  return interaction.update(buildCard(interaction.guild, target, etat));
}

module.exports = { CUSTOM_ID, repondreAvecBlacklistCard, handleBlacklistCardInteraction };
