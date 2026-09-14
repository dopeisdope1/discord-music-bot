const { ChannelType, PermissionFlagsBits } = require("discord.js");
const store = require("./counterStore");
const { buildStatusEmbed } = require("./statusEmbed");
const { can } = require("./permissions/engine");

// Compteurs de serveur : &compteur create / list / delete, et la mise à jour
// des noms de salon.
//
// LA CONTRAINTE QUI COMMANDE TOUT LE FICHIER : Discord limite le renommage
// d'un salon à DEUX fois par tranche de 10 minutes, et par salon. Au-delà, la
// requête n'échoue pas franchement — elle est mise en attente très longtemps
// côté Discord, puis appliquée. Un compteur naïf qui renomme à chaque arrivée
// se retrouve donc figé sur une valeur périmée, sans la moindre erreur pour
// le signaler : c'est le défaut classique de cette fonctionnalité.
//
// D'où la file ci-dessous : au plus un renommage par salon toutes les
// 6 minutes, et les demandes intermédiaires sont FUSIONNÉES — seule la
// dernière valeur compte, les précédentes n'ont plus d'intérêt.
const INTERVALLE_MS = 6 * 60_000;

const PERMISSION = "server.channels.manage";

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });

/**
 * État par salon : quand il a été renommé pour la dernière fois, et le
 * minuteur éventuellement armé pour appliquer la valeur en attente.
 * @type {Map<string, {dernier: number, minuteur: NodeJS.Timeout|null, attendu: string|null}>}
 */
const etats = new Map();

function etat(channelId) {
  // `-Infinity` et non `0` : la valeur signifie « jamais renommé », et doit
  // donc autoriser le premier renommage quel que soit l'instant de référence.
  // Avec `0`, un salon jamais renommé restait bloqué en attente pendant les
  // six premières minutes de l'époque Unix — invisible en production, mais
  // c'est exactement ce que les tests, eux, mesurent depuis zéro.
  if (!etats.has(channelId)) etats.set(channelId, { dernier: -Infinity, minuteur: null, attendu: null });
  return etats.get(channelId);
}

/** Coupe tous les minuteurs — utilisé par les tests pour ne rien laisser courir. */
function arreterTout() {
  for (const e of etats.values()) {
    if (e.minuteur) clearTimeout(e.minuteur);
  }
  etats.clear();
}

/**
 * Renomme un salon en respectant la cadence, ou programme le renommage.
 *
 * @param {import('discord.js').GuildChannel} channel
 * @param {string} nom
 * @param {number} [maintenant] injectable pour les tests
 * @returns {Promise<"applique"|"inchange"|"programme"|"impossible">}
 */
async function renommer(channel, nom, maintenant = Date.now()) {
  if (!channel || !nom) return "impossible";
  // Rien à faire si le nom est déjà bon : c'est ce qui évite de consommer le
  // quota pour rien, et donc de le voir manquer au moment où il compte.
  if (channel.name === nom) return "inchange";

  const e = etat(channel.id);
  const restant = e.dernier + INTERVALLE_MS - maintenant;
  if (restant > 0) {
    // Une demande déjà en attente est simplement REMPLACÉE par la nouvelle :
    // empiler les renommages ne ferait qu'appliquer des valeurs périmées les
    // unes après les autres.
    e.attendu = nom;
    if (!e.minuteur) {
      e.minuteur = setTimeout(() => {
        e.minuteur = null;
        const cible = e.attendu;
        e.attendu = null;
        if (cible) renommer(channel, cible).catch(() => {});
      }, restant);
      // Ne pas retenir le processus à l'arrêt à cause d'un compteur.
      if (typeof e.minuteur.unref === "function") e.minuteur.unref();
    }
    return "programme";
  }

  try {
    await channel.setName(nom, "Compteur de serveur");
    e.dernier = maintenant;
    return "applique";
  } catch (err) {
    console.error(`[counters] renommage refusé pour ${channel.id} :`, err.message);
    return "impossible";
  }
}

/**
 * Met à jour tous les compteurs d'un serveur.
 *
 * Silencieux par conception : appelé sur chaque arrivée et chaque départ, il
 * ne doit jamais faire remonter d'erreur dans un écouteur d'événement.
 */
async function mettreAJour(guild) {
  if (!guild) return;
  const compteurs = store.list(guild.id);
  if (!compteurs.length) return;

  // Un salon supprimé à la main laisserait sinon une entrée morte que l'on
  // rechercherait indéfiniment à chaque arrivée de membre.
  store.nettoyer(guild.id, (id) => guild.channels.cache.has(id));

  for (const compteur of store.list(guild.id)) {
    const channel = guild.channels.cache.get(compteur.channelId);
    if (!channel) continue;
    const nom = store.nomAttendu(compteur, guild);
    if (nom) await renommer(channel, nom);
  }
}

// --- &compteur ---

async function compteur(client, message, args) {
  const sub = (args[0] || "").toLowerCase();
  if (sub === "list") return lister(message);
  if (!can(message.member, PERMISSION)) return;
  if (sub === "create") return creer(client, message, args.slice(1));
  if (sub === "delete") return supprimer(message, args.slice(1));
  return reply(
    message,
    "error",
    ["`compteur create <type> [modèle]`", "`compteur list`", "`compteur delete <#salon|id>`", `Types : ${Object.keys(store.TYPES).join(", ")}`].join("\n")
  );
}

async function creer(client, message, args) {
  const type = (args[0] || "").toLowerCase();
  if (!store.TYPES[type]) {
    return reply(message, "error", `Type inconnu. Choisis parmi : ${Object.keys(store.TYPES).join(", ")}.`);
  }
  const modele = args.slice(1).join(" ").trim() || store.TYPES[type].modele;

  const me = message.guild.members.me;
  if (!me?.permissions?.has(PermissionFlagsBits.ManageChannels)) {
    return reply(message, "error", "Il me manque la permission « Gérer les salons ».");
  }

  const nom = store.nomAttendu({ type, modele }, message.guild);
  if (!nom) return reply(message, "error", "Impossible de calculer ce compteur pour l'instant.");

  let channel;
  try {
    channel = await message.guild.channels.create({
      name: nom,
      type: ChannelType.GuildVoice,
      // Salon d'AFFICHAGE : personne ne s'y connecte, tout le monde le voit.
      // Un salon vocal plutôt que textuel, parce qu'il se pose en haut de la
      // liste et n'ajoute pas de conversation là où il n'y en a pas.
      permissionOverwrites: [{ id: message.guild.roles.everyone.id, deny: [PermissionFlagsBits.Connect] }],
    });
  } catch (err) {
    return reply(message, "error", `Discord a refusé la création : ${err.message}`);
  }

  const resultat = store.add(message.guild.id, channel.id, type, modele);
  if (!resultat.ok) {
    // Le salon vient d'être créé pour rien : on le retire plutôt que de
    // laisser un salon orphelin que personne ne saura relier à quoi que ce soit.
    await channel.delete("Compteur non enregistré").catch(() => {});
    return reply(message, "error", resultat.motif);
  }
  return reply(message, "success", `Compteur créé : ${channel}. Il se met à jour au plus toutes les ${INTERVALLE_MS / 60_000} minutes.`);
}

async function supprimer(message, args) {
  const brut = (args[0] || "").replace(/[<#>]/g, "").trim();
  if (!brut) return reply(message, "error", "Indique le salon : `compteur delete <#salon|id>`.");
  if (!store.remove(message.guild.id, brut)) {
    return reply(message, "error", "Ce salon n'est pas un compteur.");
  }
  // Le salon lui-même n'est PAS supprimé : effacer un salon sur une commande
  // de configuration serait irréversible pour un geste qui ne l'annonce pas.
  return reply(message, "success", "Compteur retiré. Le salon, lui, est resté — supprime-le à la main si tu veux.");
}

async function lister(message) {
  const compteurs = store.list(message.guild.id);
  if (!compteurs.length) {
    return reply(message, "info", "Aucun compteur. Crée-en un avec `compteur create membres`.");
  }
  const lignes = compteurs.map((c) => {
    const salon = message.guild.channels.cache.get(c.channelId);
    return `${salon ? `<#${c.channelId}>` : "*(salon supprimé)*"} — ${store.TYPES[c.type]?.label || c.type} · \`${c.modele}\``;
  });
  return reply(message, "info", lignes.join("\n"));
}

module.exports = { compteur, mettreAJour, renommer, arreterTout, INTERVALLE_MS, PERMISSION };
