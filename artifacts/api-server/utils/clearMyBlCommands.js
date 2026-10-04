const { ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require("discord.js");
const { can } = require("./permissions/engine");
const { report } = require("./moderation/actions");
const zinkillerStore = require("./zinkillerStore");

// "-clearmybl" — un modérateur nettoie SES PROPRES entrées blacklist
// persistante (utils/zinkillerStore.js) sur CE serveur : celles qu'il a
// lui-même posées via "-zinkiller", débannit tout le monde d'un coup.
// Utile après un test, une purge en masse mal ciblée, etc. — action
// immédiate, aucune approbation (voir référence fournie : "Tes entrées
// blacklist ont été supprimées").
const PERMISSION = "moderation.zinkiller";

function carte(guildId, texte) {
  const container = new ContainerBuilder();
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent("## ClearMyBL"));
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(texte));
  return { flags: MessageFlags.IsComponentsV2, components: [container] };
}

/** "-clearmybl" — retire toutes les entrées blacklist de CE serveur posées par l'auteur de la commande, et débannit. */
async function clearmybl(client, message) {
  if (!can(message.member, PERMISSION)) return;

  const guild = message.guild;
  const mesEntrees = zinkillerStore.list(guild.id).filter((e) => e.moderatorId === message.author.id);

  if (!mesEntrees.length) {
    return message.reply(carte(guild.id, "Tu n'as posé aucune entrée blacklist sur ce serveur.")).catch(() => {});
  }

  let retirees = 0;
  for (const entry of mesEntrees) {
    zinkillerStore.remove(guild.id, entry.userId);
    try {
      await guild.bans.remove(entry.userId, `ClearMyBL — levé par ${message.author.tag}`);
    } catch (err) {
      zinkillerStore.add(guild.id, entry.userId, entry);
      continue;
    }
    retirees += 1;

    await report(client, {
      guildId: guild.id,
      title: "Blacklist retirée — ClearMyBL",
      fields: [
        { label: "Cible", value: `<@${entry.userId}> (${entry.userId})` },
        ...(entry.grade ? [{ label: "Grade appliqué", value: entry.grade }] : []),
        { label: "Ban sur ny", value: "levé" },
      ],
      action: "clearmybl",
      targetId: entry.userId,
      targetTag: null,
      moderator: message.author,
      channelId: message.channel.id,
    }).catch(() => {});
  }

  return message
    .reply(carte(guild.id, `Tes entrées blacklist ont été supprimées.\n**Entrées retirées** : ${retirees}`))
    .catch(() => {});
}

module.exports = { clearmybl };
