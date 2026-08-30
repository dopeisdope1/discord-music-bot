const { ActivityType } = require("discord.js");
const { buildStatusEmbed } = require("./statusEmbed");
const accessStore = require("./accessStore");
const store = require("./botProfileStore");

// Contrôle du profil/de la présence du bot — réservé au rang sys (comme
// &owners/&sources/&allbots) : ça touche le compte du bot lui-même, sur
// tous les serveurs où il se trouve.
const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });
const sysOnly = (handler) => async (client, message, args) => {
  if (!accessStore.isAllowed("sys", message.author.id)) return;
  return handler(client, message, args);
};

const STATUS_LABELS = { online: "En ligne", idle: "Inactif", dnd: "Ne pas déranger", invisible: "Invisible" };
const ACTIVITY_LABELS = {
  Playing: "Joue à",
  Listening: "Écoute",
  Watching: "Regarde",
  Competing: "Participe à",
  Streaming: "Diffuse",
};

/** Applique l'activité courante de la rotation (voir utils/botProfileStore.js) — appelé au démarrage puis périodiquement. */
function applyPresence(client) {
  const config = store.getConfig();
  const next = store.nextActivity();
  const activities = next
    ? [{ name: next.text, type: ActivityType[next.type] ?? ActivityType.Playing, url: next.type === "Streaming" ? "https://twitch.tv/discord" : undefined }]
    : [];
  client.user.setPresence({ status: config.status, activities });
}

/** Découpe "phrase1,,phrase2" en tableau — même convention que le reste du bot pour les listes de valeurs non-mentions. */
function splitPhrases(text) {
  return text
    .split(",,")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function setActivity(client, message, args, type) {
  const text = args.join(" ").trim();
  if (!text) return reply(message, "error", `Indique un texte : \`${type.toLowerCase()} <message>\` (plusieurs phrases séparées par \`,,\`).`);
  store.setActivities(type, splitPhrases(text));
  applyPresence(client);
  return reply(message, "success", `${ACTIVITY_LABELS[type]} **${splitPhrases(text).join(" / ")}**.`);
}

const handlers = {
  set: sysOnly(async (client, message, args) => {
    const sub = (args[0] || "").toLowerCase();
    const value = args.slice(1).join(" ").trim();

    if (sub === "name") {
      if (!value) return reply(message, "error", "Indique un nom : `set name <nom>`.");
      try {
        await client.user.setUsername(value);
      } catch (err) {
        return reply(message, "error", `Discord a refusé : ${err.message}`);
      }
      return reply(message, "success", `Nom du bot changé pour **${value}**.`);
    }

    if (sub === "pic") {
      const url = value || message.attachments.first()?.url;
      if (!url) return reply(message, "error", "Indique un lien ou joins une image : `set pic <lien>`.");
      try {
        await client.user.setAvatar(url);
      } catch (err) {
        return reply(message, "error", `Discord a refusé : ${err.message}`);
      }
      return reply(message, "success", "Photo de profil du bot mise à jour.");
    }

    if (sub === "banner") {
      const url = value || message.attachments.first()?.url;
      if (!url) return reply(message, "error", "Indique un lien ou joins une image : `set banner <lien>`.");
      try {
        await client.user.setBanner(url);
      } catch (err) {
        return reply(message, "error", `Discord a refusé : ${err.message}`);
      }
      return reply(message, "success", "Bannière du bot mise à jour.");
    }

    return reply(message, "error", "Utilise : `set name <nom>`, `set pic <lien>`, ou `set banner <lien>`.");
  }),

  playto: sysOnly((client, message, args) => setActivity(client, message, args, "Playing")),
  listen: sysOnly((client, message, args) => setActivity(client, message, args, "Listening")),
  watch: sysOnly((client, message, args) => setActivity(client, message, args, "Watching")),
  compet: sysOnly((client, message, args) => setActivity(client, message, args, "Competing")),
  stream: sysOnly((client, message, args) => setActivity(client, message, args, "Streaming")),

  remove: sysOnly(async (client, message, args) => {
    if ((args[0] || "").toLowerCase() !== "activity") return reply(message, "error", "Utilise : `remove activity`.");
    store.clearActivity();
    applyPresence(client);
    return reply(message, "success", "Activité du bot supprimée.");
  }),

  online: sysOnly(async (client, message) => {
    store.setStatus("online");
    applyPresence(client);
    return reply(message, "success", "Statut du bot : **En ligne**.");
  }),
  idle: sysOnly(async (client, message) => {
    store.setStatus("idle");
    applyPresence(client);
    return reply(message, "success", "Statut du bot : **Inactif**.");
  }),
  dnd: sysOnly(async (client, message) => {
    store.setStatus("dnd");
    applyPresence(client);
    return reply(message, "success", "Statut du bot : **Ne pas déranger**.");
  }),
  invisible: sysOnly(async (client, message) => {
    store.setStatus("invisible");
    applyPresence(client);
    return reply(message, "success", "Statut du bot : **Invisible**.");
  }),
};

module.exports = { botProfileHandlers: handlers, applyPresence, STATUS_LABELS, ACTIVITY_LABELS };
