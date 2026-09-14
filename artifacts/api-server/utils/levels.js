const { EMOJI } = require("./emojis");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");
const levelStore = require("./levelStore");
const readOnlyLists = require("./readOnlyLists");
const { buildListCard } = require("./listCard");

const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * À appeler depuis "messageCreate" (index.js), en parallèle des autres
 * automods légers — ne fait rien tant que "&levels on" n'a pas été utilisé
 * sur ce serveur (désactivé par défaut, comme le reste de l'automod).
 * Le cooldown (utils/levelStore.js::addXp) empêche le flood pur XP.
 */
async function checkMessage(client, message) {
  if (message.author.bot || !message.guild) return;
  const config = levelStore.getConfig(message.guild.id);
  if (!config.enabled) return;

  const gain = randomInt(config.xpMin, config.xpMax);
  const resultat = levelStore.addXp(message.guild.id, message.author.id, gain, config.cooldownSeconds);
  if (!resultat || !resultat.leveledUp) return;

  const salon = config.levelUpChannelId ? message.guild.channels.cache.get(config.levelUpChannelId) : message.channel;
  await salon
    ?.send(`${EMOJI.CROWN} <@${message.author.id}> passe **niveau ${resultat.level}** !`)
    .catch(() => {});
}

/** &rank [@membre] — XP/niveau/progression vers le niveau suivant. */
async function rank(client, message, args) {
  const cible = message.mentions.members?.first() || message.member;
  const donnees = levelStore.getUserData(message.guild.id, cible.id);
  const seuilActuel = levelStore.xpPourNiveau(donnees.level);
  const seuilSuivant = levelStore.xpPourNiveau(donnees.level + 1);
  const progression = donnees.xp - seuilActuel;
  const requis = seuilSuivant - seuilActuel;

  await message.reply({
    embeds: [
      buildStatusEmbed("info", null, {
        title: `${EMOJI.CROWN} Niveau de ${cible.displayName}`,
        thumbnail: cible.user.displayAvatarURL({ size: 256 }),
        fields: [
          { name: "Niveau", value: String(donnees.level), inline: true },
          { name: "XP total", value: String(donnees.xp), inline: true },
          { name: "Progression", value: `${progression} / ${requis} XP vers le niveau ${donnees.level + 1}`, inline: false },
        ],
      }),
    ],
  });
}

/** &leaderboard — classement paginé, même carte que &owners/&allbots (utils/listCard.js). */
async function leaderboard(client, message) {
  const { title, description, items } = readOnlyLists.DEFINITIONS.leaderboard.build(message.guild);
  await message.reply(buildListCard({ idKind: "leaderboard", title, description, items, page: 0, canEdit: false }));
}

/** &levels on/off — active ou désactive le système pour CE serveur (server.levels.manage). */
async function levelsToggle(client, message, args) {
  if (!can(message.member, "server.levels.manage")) return;
  const sub = (args[0] || "").toLowerCase();
  if (sub !== "on" && sub !== "off") {
    return message.reply({ embeds: [buildStatusEmbed("info", "Utilisation : `&levels on` ou `&levels off`.")] });
  }
  levelStore.setEnabled(message.guild.id, sub === "on");
  return message.reply({
    embeds: [buildStatusEmbed("success", `Système de niveaux ${sub === "on" ? "activé" : "désactivé"} sur ce serveur.`)],
  });
}

module.exports = { checkMessage, rank, leaderboard, levelsToggle };
