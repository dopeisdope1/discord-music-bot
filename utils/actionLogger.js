const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  MessageFlags,
} = require("discord.js");
const { getLogChannelId, LOG_CATEGORIES } = require("./logStore");

/**
 * Construit un log en Components V2 (même style que `.panel`/`.help`/les
 * panels de modération), avec une barre d'accent colorée par catégorie et
 * l'avatar de l'auteur en vignette au lieu du look "carte" des embeds classiques.
 */
function buildLogPanel({ title, description, actor, fields, category }) {
  const meta = LOG_CATEGORIES[category];
  const container = new ContainerBuilder();
  if (meta?.color !== undefined) container.setAccentColor(meta.color);

  const headerText = new TextDisplayBuilder().setContent(`## ${title}\n${description}`);
  if (actor) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(headerText)
        .setThumbnailAccessory((thumbnail) => thumbnail.setURL(actor.displayAvatarURL()))
    );
  } else {
    container.addTextDisplayComponents(headerText);
  }

  if (fields?.length) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent(fields.map((f) => `**${f.name} :** ${f.value}`).join("\n"))
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      [actor ? `Par **${actor.tag}**` : null, meta?.label, `<t:${Math.floor(Date.now() / 1000)}:f>`]
        .filter(Boolean)
        .join(" • ")
    )
  );

  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/**
 * Envoie un panel de log (Components V2) dans le salon configuré pour cette
 * catégorie (voir `.panel` > Logs). Ne fait rien si aucun salon n'est
 * configuré ou si le bot ne peut pas y écrire.
 * @param {import('discord.js').Client} client
 * @param {string} guildId
 * @param {"moderation"|"salon"|"roles"} category
 * @param {object} entry
 * @param {string} entry.title — action loguée (ex: "Clear", "Ban", "Massrole — ajout")
 * @param {string} entry.description — résumé en une phrase
 * @param {import('discord.js').User} [entry.actor] — auteur de l'action (avatar + pseudo)
 * @param {{ name: string, value: string }[]} [entry.fields]
 */
async function sendLog(client, guildId, category, { title, description, actor, fields } = {}) {
  const channelId = getLogChannelId(guildId, category);
  if (!channelId) return;
  const channel = client.channels.cache.get(channelId);
  if (!channel?.isTextBased()) return;

  await channel.send(buildLogPanel({ title, description, actor, fields, category })).catch(() => {});
}

module.exports = { sendLog };
