const {
  PermissionFlagsBits,
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
const { checkHierarchy, checkBotPermission, report } = require("./moderation/actions");
const { carteSanctionMessage } = require("./actionCard");
const { formatDuration } = require("./moderationCommands");
const tempBanStore = require("./tempBanStore");
const banReasonsStore = require("./banReasonsStore");
const zinkillerStore = require("./zinkillerStore");
const altLinksStore = require("./altLinksStore");
const rankLadder = require("./rankLadderCommands");
const messageOwner = require("./messageOwner");

// "&baninfo <@membre>" — carte "raisons" (demande explicite, calquée sur la
// présentation d'un autre bot) : choisir une raison PRÉDÉFINIE (gérée par
// serveur via &panel, utils/banReasonsStore.js) ou personnalisée, une durée
// (permanent ou temporaire, réutilise &tempban, utils/tempBanStore.js), et
// optionnellement relier ce ban à un compte DÉJÀ signalé ("Double compte
// de" — liste des bans persistants, utils/zinkillerStore.js, jamais une
// détection automatique, voir utils/altLinksStore.js), puis confirmer/
// annuler. Séparée de "&ban" (utils/banPanel.js), qui reste volontairement
// instantané sans confirmation (demande explicite passée) : "&baninfo" est
// le choix à faire quand la raison/durée/lien méritent d'être posés avant,
// jamais l'inverse.
const CUSTOM_ID = "baninfo";
const PERMISSION = "moderation.ban";

// customId Discord plafonné à 100 caractères, et l'état (raison + durée)
// doit survivre entre plusieurs clics indépendants sur le MÊME message :
// gardé en mémoire, keyé par l'ID du message-carte, plutôt que recalculé à
// chaque fois depuis un customId qui déborderait vite. Purge au-delà d'une
// heure, comme utils/banPanel.js::pending.
const etats = new Map();
const TTL_MS = 60 * 60 * 1000;

function purger() {
  const maintenant = Date.now();
  for (const [id, e] of etats) if (maintenant - e.at > TTL_MS) etats.delete(id);
}

const DUREES = [
  { id: "perm", label: "Permanent", ms: null },
  { id: "1h", label: "1 heure", ms: 3_600_000 },
  { id: "6h", label: "6 heures", ms: 21_600_000 },
  { id: "1j", label: "1 jour", ms: 86_400_000 },
  { id: "3j", label: "3 jours", ms: 3 * 86_400_000 },
  { id: "7j", label: "7 jours", ms: 7 * 86_400_000 },
  { id: "30j", label: "30 jours", ms: 30 * 86_400_000 },
];

function gradeDe(guild, member) {
  const idx = rankLadder.currentIndex(guild, member);
  if (idx < 0) return "Aucun";
  const ladder = rankLadder.ladderRoles(guild);
  const role = guild.roles.cache.get(ladder[idx]);
  return role ? role.name : `niveau #${ladder.length - idx}`;
}

const AUCUN_LIEN = "aucun";

/** Comptes déjà signalés (bans persistants, &zinkiller) proposables comme "compte principal" — jamais la cible elle-même. */
function candidatsDoubleCompte(guild, target) {
  return zinkillerStore.list(guild.id).filter((e) => e.userId !== target.id);
}

function buildBanInfoCard(guild, target, etat) {
  const raisons = banReasonsStore.list(guild.id);
  const raisonChoisie = etat.reasonLabel || "aucune";
  const dureeChoisie = DUREES.find((d) => d.id === etat.dureeId)?.label || "à choisir";
  const candidats = candidatsDoubleCompte(guild, target);
  const doubleCompteChoisi = etat.linkedToId ? `<@${etat.linkedToId}>` : "aucun";

  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Blacklist · raisons"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [
        `**Cible** : ${target} — \`${target.id}\``,
        `**Pseudo** : ${target.user?.tag || target.user?.username || target.id}`,
        `**Grade** : ${gradeDe(guild, target)}`,
        `**Durée** : ${dureeChoisie}`,
        "",
        `**Raison sélectionnée** : ${raisonChoisie}`,
        `**Double compte de** : ${doubleCompteChoisi}`,
      ].join("\n")
    )
  );

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  const optionsRaisons = [
    ...raisons.map((r) =>
      new StringSelectMenuOptionBuilder().setLabel(r.label.slice(0, 100)).setValue(r.id).setDefault(etat.reasonId === r.id)
    ),
    new StringSelectMenuOptionBuilder()
      .setLabel("Raison personnalisée…")
      .setValue("custom")
      .setDefault(Boolean(etat.reasonId === "custom")),
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
  // "Double compte de" : relie ce ban à un compte DÉJÀ signalé (liste des
  // bans persistants, &zinkiller) — jamais une détection automatique, juste
  // le lien que le modérateur pose lui-même. Absent du menu si personne
  // n'est encore signalé sur ce serveur.
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

async function repondreAvecBanInfo(message, target) {
  const envoye = await messageOwner.repondreEtRetenir(message, buildBanInfoCard(message.guild, target, {}));
  if (envoye?.id) etats.set(envoye.id, { targetId: target.id, reasonId: null, reasonLabel: null, dureeId: null, linkedToId: null, at: Date.now() });
  purger();
  return envoye;
}

async function handleBanInfoInteraction(interaction) {
  const [, action, targetId] = interaction.customId.split(":");
  if (!can(interaction.member, PERMISSION)) {
    return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
  }

  const messageId = interaction.message?.id;
  const etat = etats.get(messageId) || { targetId, reasonId: null, reasonLabel: null, dureeId: null, linkedToId: null, at: Date.now() };

  if (action === "reason" && interaction.values[0] === "custom") {
    const modal = new ModalBuilder().setCustomId(`${CUSTOM_ID}:reasoncustom:${targetId}`).setTitle("Raison personnalisée");
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
  } else if (action === "reason") {
    const choisie = banReasonsStore.get(interaction.guild.id, interaction.values[0]);
    etat.reasonId = interaction.values[0];
    etat.reasonLabel = choisie?.label || null;
  } else if (action === "duree") {
    etat.dureeId = interaction.values[0];
  } else if (action === "lien") {
    etat.linkedToId = interaction.values[0] === AUCUN_LIEN ? null : interaction.values[0];
  }

  const target = await interaction.guild.members.fetch(etat.targetId).catch(() => null);
  if (!target) return interaction.reply({ content: "Ce membre n'est plus sur le serveur.", flags: MessageFlags.Ephemeral });

  if (action === "no") {
    etats.delete(messageId);
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## Blacklist · raisons\n*Annulé.*"));
    return interaction.update({ flags: MessageFlags.IsComponentsV2, components: [container] });
  }

  if (action === "go") {
    if (!etat.reasonLabel) return interaction.reply({ content: "Choisis une raison d'abord.", flags: MessageFlags.Ephemeral });
    if (!etat.dureeId) return interaction.reply({ content: "Choisis une durée d'abord.", flags: MessageFlags.Ephemeral });

    const refusal = checkHierarchy(interaction.guild, interaction.member, target);
    if (refusal) return interaction.reply({ content: refusal, flags: MessageFlags.Ephemeral });
    const botPerm = checkBotPermission(interaction.guild, PermissionFlagsBits.BanMembers, "BanMembers");
    if (botPerm) return interaction.reply({ content: botPerm, flags: MessageFlags.Ephemeral });

    const duree = DUREES.find((d) => d.id === etat.dureeId);
    const tag = target.user.tag;
    try {
      await target.ban({ reason: `${etat.reasonLabel} — par ${interaction.user.tag}` });
    } catch (err) {
      return interaction.reply({ content: `Discord a refusé : ${err.message}`, flags: MessageFlags.Ephemeral });
    }
    if (duree.ms) tempBanStore.add(interaction.guild.id, target.id, Date.now() + duree.ms);
    if (etat.linkedToId) altLinksStore.link(interaction.guild.id, target.id, etat.linkedToId);

    await report(interaction.client, {
      guildId: interaction.guild.id,
      category: "moderation",
      title: duree.ms ? "Ban temporaire" : "Bannissement",
      fields: [
        { label: "Cible", value: `<@${target.id}> (${target.id})` },
        { label: "Raison", value: etat.reasonLabel },
        { label: "Durée", value: duree.label },
        ...(etat.linkedToId ? [{ label: "Double compte de", value: `<@${etat.linkedToId}>` }] : []),
      ],
      action: duree.ms ? "tempban" : "ban",
      targetId: target.id,
      targetTag: tag,
      moderator: interaction.user,
      reason: etat.reasonLabel,
      channelId: interaction.channelId,
    });

    etats.delete(messageId);
    const carte = await carteSanctionMessage({
      action: duree.ms ? "tempban" : "ban",
      cible: target,
      moderateur: interaction.user,
      raison: etat.reasonLabel,
      duree: duree.ms ? formatDuration(duree.ms) : "Définitif",
      serveur: interaction.guild.name,
    });
    if (carte) {
      try {
        return await interaction.update({ ...carte, components: [], attachments: [] });
      } catch (err) {
        console.error("[banInfoCard] carte non envoyée :", err.message);
      }
    }
    const container = new ContainerBuilder();
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## Blacklist · raisons\n**${tag}** banni — ${duree.label}.\nRaison : ${etat.reasonLabel}${etat.linkedToId ? `\nDouble compte de : <@${etat.linkedToId}>` : ""}`
      )
    );
    return interaction.update({ flags: MessageFlags.IsComponentsV2, components: [container] });
  }

  etats.set(messageId, etat);
  return interaction.update(buildBanInfoCard(interaction.guild, target, etat));
}

module.exports = { CUSTOM_ID, buildBanInfoCard, repondreAvecBanInfo, handleBanInfoInteraction };
