const { ChannelType, ActivityType } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const { buildListCard } = require("./listCard");
const readOnlyLists = require("./readOnlyLists");
const { moderationHandlers } = require("./moderationCommands");
const { can } = require("./permissions/engine");
const calc = require("./calc");
const wikipedia = require("./wikipedia");

// Commandes utilitaires en LECTURE SEULE : les fiches d'info individuelles
// (&pic/&server/&userinfo...) n'exigent aucune permission (`permission:
// null` dans utils/commandCatalog.js). Exceptions, demandées explicitement,
// pour ce qui expose l'activité ou la structure du serveur plutôt qu'une
// fiche ciblée :
//  - &vc/&stats -> `server.stats.view`
//  - &alladmins/&botadmins/&boosters/&rolemembers -> `server.members.list`
//  - &vocinfo/&user/&emoji -> `server.info.view`
//
// Contrairement aux commandes de modération, celles-ci RÉPONDENT en cas de
// mauvais usage au lieu de rester muettes : le silence sur le préfixe "&"
// sert à ne pas parler à la place du CrowBot, et aucun de ces noms ne lui
// appartient — une faute de frappe mérite donc une explication. Exception :
// un refus de permission reste silencieux, comme partout ailleurs dans le
// bot (voir &vc/&stats) — pas la peine d'annoncer qu'une commande existe à
// qui n'a pas le droit de la lancer.

const reply = (message, kind, text, options) => message.reply({ embeds: [buildStatusEmbed(kind, text, options)] });

/** Poste la première page d'une liste définie dans utils/readOnlyLists.js. */
async function postList(message, kind, arg) {
  await readOnlyLists.ensureMembersCached(message.guild);
  const built = readOnlyLists.DEFINITIONS[kind].build(message.guild, arg);
  if (!built) return null;
  // L'argument voyage dans le customId (voir utils/listCard.js) pour que le
  // sélecteur de page sache quoi recalculer au clic.
  const idKind = arg ? `${kind}/${arg}` : kind;
  await message.reply(buildListCard({ idKind, title: built.title, description: built.description, items: built.items, page: 0, canEdit: false }));
  return built;
}

/**
 * Rôle visé : mention, ID brut, ou nom (exact d'abord, puis approchant) —
 * "les paramètres peuvent être des noms, des mentions, ou des IDs".
 */
function resolveRole(message, args) {
  const mentioned = message.mentions.roles?.first();
  if (mentioned) return mentioned;

  const raw = args.join(" ").trim();
  if (!raw) return null;

  const byId = message.guild.roles.cache.get(raw.replace(/\D/g, ""));
  if (byId) return byId;

  const lowered = raw.toLowerCase();
  return (
    message.guild.roles.cache.find((r) => r.name.toLowerCase() === lowered) ||
    message.guild.roles.cache.find((r) => r.name.toLowerCase().includes(lowered)) ||
    null
  );
}

/** Utilisateur visé : mention, ID brut (même hors serveur), ou l'auteur. */
async function resolveUser(message, args) {
  const mentioned = message.mentions.users?.first();
  if (mentioned) return mentioned;

  const rawId = (args[0] || "").replace(/\D/g, "");
  if (rawId.length >= 15) return message.client.users.fetch(rawId).catch(() => null);
  return message.author;
}

const handlers = {
  // --- Listes paginées (voir utils/readOnlyLists.js) ---

  async alladmins(client, message) {
    if (!can(message.member, "server.members.list")) return;
    await postList(message, "alladmins");
  },

  async botadmins(client, message) {
    if (!can(message.member, "server.members.list")) return;
    await postList(message, "botadmins");
  },

  async boosters(client, message) {
    if (!can(message.member, "server.members.list")) return;
    await postList(message, "boosters");
  },

  async rolemembers(client, message, args) {
    if (!can(message.member, "server.members.list")) return;
    const role = resolveRole(message, args);
    if (!role) return reply(message, "error", "Indique un rôle (mention, ID ou nom) : `rolemembers @rôle`.");
    await postList(message, "rolemembers", role.id);
  },

  // --- Fiches d'information ---

  /**
   * &user — le COMPTE Discord, indépendamment du serveur : il répond donc
   * aussi pour quelqu'un qui n'est pas (ou plus) membre, contrairement à
   * &member/&userinfo qui décrivent l'appartenance au serveur.
   */
  async user(client, message, args) {
    if (!can(message.member, "server.info.view")) return;
    const user = await resolveUser(message, args);
    if (!user) return reply(message, "error", "Utilisateur introuvable : donne une mention ou un ID valide.");

    const member = await message.guild.members.fetch(user.id).catch(() => null);
    const lines = [
      `**Compte** : ${user.tag} (${user.id})`,
      `**Type** : ${user.bot ? "bot" : "utilisateur"}`,
      `**Compte créé** : <t:${Math.floor(user.createdTimestamp / 1000)}:f> (<t:${Math.floor(user.createdTimestamp / 1000)}:R>)`,
      member
        ? `**Sur ce serveur** : oui, depuis <t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
        : "**Sur ce serveur** : non — utilise `member` pour les infos liées au serveur.",
    ];
    await reply(message, "info", lines.join("\n"), {
      title: "Informations utilisateur",
      thumbnail: user.displayAvatarURL({ size: 256 }),
    });
  },

  /**
   * &member — l'appartenance au SERVEUR. Même vue que &userinfo, qui répond
   * déjà exactement à cette description : un seul rendu, deux noms, plutôt
   * qu'une deuxième fiche qui divergerait à la première retouche.
   */
  member: (client, message, args) => moderationHandlers.userinfo(client, message, args),

  /** &vc — un chiffre unique : combien de personnes sont en vocal maintenant. */
  vc(client, message) {
    if (!can(message.member, "server.stats.view")) return;
    const count = [...message.guild.channels.cache.values()]
      .filter((c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)
      .reduce((total, c) => total + c.members.size, 0);
    return reply(message, "info", `🔊 Il y a **${count}** personne${count > 1 ? "s" : ""} en vocal actuellement.`);
  },

  /**
   * &stats — statistiques d'ensemble du serveur (membres, présence, vocal).
   * "Actifs" = joue à un jeu/utilise une appli en ce moment (activité de
   * présence Discord hors statut personnalisé), pas une notion de messages
   * récents — rien de tel n'est suivi par ce bot.
   */
  async stats(client, message) {
    if (!can(message.member, "server.stats.view")) return;
    const guild = message.guild;
    await readOnlyLists.ensureMembersCached(guild);
    const members = guild.members.cache;

    const online = members.filter((m) => m.presence && m.presence.status !== "offline").size;
    const inVoice = members.filter((m) => m.voice.channelId).size;
    const streaming = members.filter((m) => m.voice.streaming || m.voice.selfVideo).size;
    const active = members.filter((m) => m.presence?.activities?.some((a) => a.type !== ActivityType.Custom)).size;
    const muted = members.filter((m) => m.voice.channelId && m.voice.mute).size;

    await reply(message, "info", null, {
      title: `📊 Statistiques de ${guild.name}`,
      thumbnail: guild.iconURL({ size: 256 }) || undefined,
      fields: [
        { name: "Membres", value: guild.memberCount.toLocaleString("fr-FR"), inline: true },
        { name: "En ligne", value: online.toLocaleString("fr-FR"), inline: true },
        { name: "En vocal", value: inVoice.toLocaleString("fr-FR"), inline: true },
        { name: "En stream", value: streaming.toLocaleString("fr-FR"), inline: true },
        { name: "Actifs", value: active.toLocaleString("fr-FR"), inline: true },
        { name: "Mute", value: muted.toLocaleString("fr-FR"), inline: true },
      ],
    });
  },

  /** &vocinfo — état vocal du serveur, salon par salon. */
  async vocinfo(client, message) {
    if (!can(message.member, "server.info.view")) return;
    const voiceChannels = [...message.guild.channels.cache.values()]
      .filter((c) => c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice)
      .sort((a, b) => b.members.size - a.members.size || a.rawPosition - b.rawPosition);

    const connected = voiceChannels.reduce((total, c) => total + c.members.size, 0);
    const occupied = voiceChannels.filter((c) => c.members.size > 0);
    const states = [...message.guild.voiceStates.cache.values()].filter((s) => s.channelId);

    const lines = [
      `**Salons vocaux** : ${voiceChannels.length} (dont ${occupied.length} occupé${occupied.length > 1 ? "s" : ""})`,
      `**Membres connectés** : ${connected}`,
      `**Micro coupé** : ${states.filter((s) => s.mute).length} — **casque coupé** : ${states.filter((s) => s.deaf).length}`,
      `**En partage d'écran/caméra** : ${states.filter((s) => s.streaming || s.selfVideo).length}`,
      "",
      occupied.length
        ? occupied
            .slice(0, 15)
            .map((c) => `${c} — ${c.members.size}${c.userLimit ? `/${c.userLimit}` : ""}`)
            .join("\n")
        : "*Aucun salon vocal occupé pour le moment.*",
    ];
    if (occupied.length > 15) lines.push(`*… et ${occupied.length - 15} autre(s) salon(s) occupé(s).*`);

    await reply(message, "info", lines.join("\n"), { title: "Activité vocale du serveur" });
  },

  /**
   * &emoji — récupère l'image d'un émoji personnalisé, donné en émoji
   * (`<:nom:id>`), en ID ou en nom. Un émoji Unicode (😀) n'a pas d'image à
   * récupérer : il est rendu par la police du client, pas par Discord.
   */
  async emoji(client, message, args) {
    if (!can(message.member, "server.info.view")) return;
    const raw = args.join(" ").trim();
    if (!raw) return reply(message, "error", "Indique un émoji : `emoji <:nom:id>`, son nom ou son ID.");

    const parsed = /<(a)?:(\w+):(\d+)>/.exec(raw);
    const id = parsed?.[3] || (/^\d{15,25}$/.test(raw) ? raw : null);
    const animated = parsed ? Boolean(parsed[1]) : null;

    // Un émoji d'un AUTRE serveur reste affichable : son image est publique,
    // seul l'objet GuildEmoji manque, d'où l'URL reconstruite à la main.
    const known = id ? message.guild.emojis.cache.get(id) : message.guild.emojis.cache.find((e) => e.name.toLowerCase() === raw.toLowerCase());

    if (!known && !id) {
      return reply(
        message,
        "error",
        // \p{Emoji} seul dirait "oui" pour "123" ou "#" : ces caractères
        // portent la propriété Emoji sans être des émojis pour autant.
        /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\uFE0F/u.test(raw)
          ? "C'est un émoji Unicode : il est dessiné par ton appareil, Discord n'en héberge aucune image."
          : "Émoji introuvable : donne un émoji personnalisé, son nom (sur ce serveur) ou son ID."
      );
    }

    const emojiId = known?.id || id;
    const isAnimated = known ? known.animated : animated ?? false;
    const url = known?.imageURL({ size: 256 }) || `https://cdn.discordapp.com/emojis/${emojiId}.${isAnimated ? "gif" : "png"}?size=256`;
    const lines = [
      `**Nom** : ${known?.name || parsed?.[2] || "inconnu"}`,
      `**ID** : ${emojiId}`,
      `**Animé** : ${isAnimated ? "oui" : "non"}`,
      known ? `**Ajouté le** : <t:${Math.floor(known.createdTimestamp / 1000)}:D>` : "**Origine** : un autre serveur",
      `[Ouvrir l'image](${url})`,
    ];
    await reply(message, "info", lines.join("\n"), { title: "Informations émoji", image: url });
  },

  // --- Outils ---

  /** &calc — voir utils/calc.js (parseur maison, jamais eval()). */
  async calc(client, message, args) {
    try {
      const { expression, result, solved } = calc.compute(args.join(" "));
      await reply(message, "info", `\`${expression}\`\n\n**${result}**`, { title: solved ? "Équation résolue" : "Calcul" });
    } catch (err) {
      if (!(err instanceof calc.CalcError)) throw err;
      await reply(message, "error", err.message);
    }
  },

  /** &wiki <mot-clé> — résumé de l'article Wikipédia (fr) correspondant. */
  async wiki(client, message, args) {
    const term = args.join(" ").trim();
    if (!term) return reply(message, "error", "Donne un mot-clé : `wiki Ada Lovelace`.");

    const article = await wikipedia.summary(term).catch(() => "unreachable");
    if (article === "unreachable") return reply(message, "error", "Wikipédia est injoignable pour le moment, réessaie plus tard.");
    if (!article) {
      return reply(message, "error", `Aucun article pour « ${term} ». Essaie \`search wiki ${term}\` pour voir les articles proches.`);
    }

    const extract = article.extract.length > 1000 ? `${article.extract.slice(0, 1000).trimEnd()}…` : article.extract;
    await reply(message, "info", `${extract}\n\n[Lire sur Wikipédia](${article.url})`, {
      title: article.disambiguation ? `${article.title} (page d'homonymie)` : article.title,
      thumbnail: article.thumbnail || undefined,
    });
  },

  /** &search wiki <mot-clé> — tous les articles proches du mot-clé. */
  async searchWiki(client, message, args) {
    const term = args.join(" ").trim();
    if (!term) return reply(message, "error", "Donne un mot-clé : `search wiki Ada Lovelace`.");

    const results = await wikipedia.search(term).catch(() => null);
    if (!results) return reply(message, "error", "Wikipédia est injoignable pour le moment, réessaie plus tard.");
    if (!results.length) return reply(message, "error", `Aucun article ne correspond à « ${term} ».`);

    const lines = results.map((r, i) => `**${i + 1}.** [${r.title}](${r.url})${r.snippet ? `\n${r.snippet.slice(0, 120)}…` : ""}`);
    await reply(message, "info", lines.join("\n\n"), { title: `Articles Wikipédia pour « ${term} »` });
  },
};

module.exports = { utilityHandlers: handlers, resolveRole, resolveUser };
