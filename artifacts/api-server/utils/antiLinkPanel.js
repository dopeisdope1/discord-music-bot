const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MentionableSelectMenuBuilder,
  MessageFlags,
} = require("discord.js");
const antiLink = require("./automod/antiLink");
const linkBypass = require("./automod/antiLinkBypass");
const { can } = require("./permissions/engine");
const messageOwner = require("./messageOwner");

// "!!antilink panel" — panneau dédié à l'anti-lien : mode + deux listes de
// bypass (membres/rôles) indépendantes, "Tous les liens" et "Liens Discord"
// (voir utils/automod/antiLinkBypass.js). Fichier à part, comme
// utils/palierPanel.js : son propre préfixe de customId ("alink:"), aucune
// dépendance à la machine à états d'utils/securityPanel.js.
const CUSTOM_ID = "alink";
const PERMISSION = "protection.automod";

const MODE_LABELS = { off: "Désactivé", invite: "Anti-Discord", all: "Anti-All" };

function mentionsDe({ users, roles }) {
  const tout = [...users.map((id) => `<@${id}>`), ...roles.map((id) => `<@&${id}>`)];
  return tout.length ? tout.join(", ") : "*Aucun*";
}

/**
 * @param {{ action?: "add_all"|"add_invite"|"remove" }} [state] quel
 *   sélecteur secondaire est déplié — jamais persisté, reconstruit à chaque
 *   clic à partir du bouton pressé.
 */
function buildAntiLinkPanel(guild, member, state = {}) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      "## Panel Anti-Link\nConfigurez la protection contre les liens et définissez les membres bypass."
    )
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));

  const config = antiLink.getConfig(guild.id);
  const modeCle = config.enabled ? config.mode : "off";
  const bypassAll = linkBypass.getBypass(guild.id, "all");
  const bypassInvite = linkBypass.getBypass(guild.id, "invite");

  // Deux sections distinctes (Mode / Bypass) plutôt qu'un seul bloc — refonte
  // visuelle : Components V2 n'a pas de couleur de container, la hiérarchie
  // se fait par segmentation en plusieurs TextDisplay/Separator, même
  // principe que utils/securityPanel.js et utils/personalProtection.js.
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### Mode\n**Actuel** : \`${MODE_LABELS[modeCle]}\``));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      ["### Bypass", `**Tous les liens** : ${mentionsDe(bypassAll)}`, `**Liens Discord** : ${mentionsDe(bypassInvite)}`].join("\n")
    )
  );

  if (!can(member, PERMISSION)) return { flags: MessageFlags.IsComponentsV2, components: [container] };

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${CUSTOM_ID}:action`)
        .setPlaceholder("Choisir une action")
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel("Mode : Désactivé").setValue("mode_off"),
          new StringSelectMenuOptionBuilder().setLabel("Mode : Anti-Discord").setValue("mode_invite"),
          new StringSelectMenuOptionBuilder().setLabel("Mode : Anti-All").setValue("mode_all"),
          new StringSelectMenuOptionBuilder().setLabel("Ajouter Bypass (Tous les liens)").setValue("add_all"),
          new StringSelectMenuOptionBuilder().setLabel("Ajouter Bypass (Liens Discord)").setValue("add_invite"),
          new StringSelectMenuOptionBuilder().setLabel("Supprimer un Bypass").setValue("remove")
        )
    )
  );

  if (state.action === "add_all" || state.action === "add_invite") {
    const scope = state.action === "add_all" ? "all" : "invite";
    container.addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new MentionableSelectMenuBuilder()
          .setCustomId(`${CUSTOM_ID}:addpick:${scope}`)
          .setPlaceholder(`Choisir un membre ou un rôle à ajouter (${scope === "all" ? "Tous les liens" : "Liens Discord"})`)
      )
    );
  } else if (state.action === "remove") {
    const entrees = [
      ...bypassAll.users.map((id) => ({ scope: "all", kind: "users", id, libelle: `Tous les liens — <@${id}>` })),
      ...bypassAll.roles.map((id) => ({ scope: "all", kind: "roles", id, libelle: `Tous les liens — <@&${id}>` })),
      ...bypassInvite.users.map((id) => ({ scope: "invite", kind: "users", id, libelle: `Liens Discord — <@${id}>` })),
      ...bypassInvite.roles.map((id) => ({ scope: "invite", kind: "roles", id, libelle: `Liens Discord — <@&${id}>` })),
    ];
    if (!entrees.length) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent("*Aucun bypass à supprimer.*"));
    } else {
      container.addActionRowComponents(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`${CUSTOM_ID}:removepick`)
            .setPlaceholder("Choisir le bypass à supprimer")
            .addOptions(
              entrees
                .slice(0, 25)
                .map((e) => new StringSelectMenuOptionBuilder().setLabel(e.libelle.slice(0, 100)).setValue(`${e.scope}:${e.kind}:${e.id}`))
            )
        )
      );
    }
  }

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** "!!antilink panel" — réservé à protection.automod, comme le reste de &antilink/&link. */
async function handleAntiLinkPanelCommand(client, message) {
  if (!can(message.member, PERMISSION)) return;
  return messageOwner.repondreEtRetenir(message, buildAntiLinkPanel(message.guild, message.member, {}));
}

function refuse(interaction) {
  return interaction.reply({ content: "Tu n'as pas la permission nécessaire pour cette action.", flags: MessageFlags.Ephemeral });
}

async function handleAntiLinkInteraction(interaction) {
  const { guild, member } = interaction;
  if (!can(member, PERMISSION)) return refuse(interaction);

  const [, action, extra] = interaction.customId.split(":");

  if (action === "action") {
    const choix = interaction.values[0];
    if (choix === "mode_off") antiLink.setEnabled(guild.id, false);
    else if (choix === "mode_invite") {
      antiLink.setMode(guild.id, "invite");
      antiLink.setEnabled(guild.id, true);
    } else if (choix === "mode_all") {
      antiLink.setMode(guild.id, "all");
      antiLink.setEnabled(guild.id, true);
    }
    const etatSuivant = choix.startsWith("mode_") ? {} : { action: choix };
    return interaction.update(buildAntiLinkPanel(guild, member, etatSuivant));
  }

  if (action === "addpick") {
    const scope = extra === "all" ? "all" : "invite";
    const id = interaction.values[0];
    const kind = interaction.roles?.has(id) ? "roles" : "users";
    linkBypass.addBypass(guild.id, scope, kind, id);
    return interaction.update(buildAntiLinkPanel(guild, member, {}));
  }

  if (action === "removepick") {
    const [scope, kind, id] = interaction.values[0].split(":");
    linkBypass.removeBypass(guild.id, scope, kind, id);
    return interaction.update(buildAntiLinkPanel(guild, member, {}));
  }
}

module.exports = { buildAntiLinkPanel, handleAntiLinkPanelCommand, handleAntiLinkInteraction, CUSTOM_ID };
