const { can } = require("./permissions/engine");
const { buildStatusEmbed } = require("./statusEmbed");
const antiSpam = require("./automod/antiSpam");
const antiLink = require("./automod/antiLink");
const antiMention = require("./automod/antiMention");
const badWords = require("./automod/badWords");

// Commandes texte pour l'automod léger (anti-lien/anti-mass-mention/mots
// interdits) — même clé de permission que l'anti-spam existant
// ("protection.automod"), configurable aussi depuis &panel > Protection.
const PERMISSION = "protection.automod";

const reply = (message, kind, text) => message.reply({ embeds: [buildStatusEmbed(kind, text)] });

const handlers = {
  /**
   * &antispam <on/off> — et &antispam <nombre>/<durée> pour le seuil, la forme
   * documentée au catalogue (`5/10` = 5 messages en 10 secondes).
   */
  async antispam(client, message, args) {
    if (!can(message.member, PERMISSION)) return;
    const sub = (args[0] || "").toLowerCase();

    if (sub === "on" || sub === "off") {
      antiSpam.setEnabled(message.guild.id, sub === "on");
      return reply(message, "success", `Anti-spam ${sub === "on" ? "activé" : "désactivé"}.`);
    }

    const seuil = /^(\d+)\s*\/\s*(\d+)$/.exec(args.join(""));
    if (seuil) {
      const regle = antiSpam.setThreshold(message.guild.id, parseInt(seuil[1], 10), parseInt(seuil[2], 10));
      const { minMessages, maxMessages, minWindow, maxWindow } = antiSpam.THRESHOLD_LIMITS;
      if (!regle) {
        return reply(
          message,
          "error",
          `Seuil hors bornes : de ${minMessages} à ${maxMessages} messages, sur une fenêtre de ${minWindow} à ${maxWindow} secondes.`
        );
      }
      // Régler un seuil sans activer l'anti-spam ne protégerait de rien : on
      // le dit plutôt que de laisser croire que c'est en place.
      const actif = antiSpam.getConfig(message.guild.id).enabled;
      return reply(
        message,
        "success",
        `Anti-spam réglé sur **${regle.maxMessages} messages en ${regle.windowSeconds}s**.` +
          (actif ? "" : "\n⚠️ L'anti-spam est **désactivé** — `antispam on` pour l'activer.")
      );
    }

    const config = antiSpam.getConfig(message.guild.id);
    const exemptes = antiSpam.getExemptChannels(message.guild.id);
    return reply(
      message,
      "info",
      [
        `> **Anti-spam** : ${config.enabled ? "activé" : "désactivé"}`,
        `> **Seuil** : ${config.maxMessages} messages en ${config.windowSeconds}s → timeout de ${config.timeoutSeconds}s`,
        `> **Salons exemptés** : ${exemptes.length ? exemptes.map((id) => `<#${id}>`).join(", ") : "*aucun*"}`,
        "",
        "`antispam <on/off>` ou `antispam <nombre>/<durée>`.",
      ].join("\n")
    );
  },

  /** &spam <allow/deny/reset> [salon] — exempte un salon, même forme que &link. */
  async spam(client, message, args) {
    if (!can(message.member, PERMISSION)) return;
    const sub = (args[0] || "").toLowerCase();
    const channel = message.mentions.channels?.first() || message.channel;

    if (!["allow", "deny", "reset"].includes(sub)) {
      return reply(message, "error", "Utilise : `spam <allow/deny/reset> [#salon]`.");
    }
    // "allow" = on autorise le flood ici, donc on exempte. "deny"/"reset"
    // remettent le salon sous surveillance — même logique que &link.
    antiSpam.setChannelExempt(message.guild.id, channel.id, sub === "allow");
    return reply(
      message,
      "success",
      sub === "allow" ? `${channel} est désormais exempté de l'anti-spam.` : `${channel} applique l'anti-spam normalement.`
    );
  },

  async antilink(client, message, args) {
    if (!can(message.member, PERMISSION)) return;
    const sub = (args[0] || "").toLowerCase();

    if (sub === "on" || sub === "off") {
      antiLink.setEnabled(message.guild.id, sub === "on");
      return reply(message, "success", `Anti-lien ${sub === "on" ? "activé" : "désactivé"}.`);
    }
    if (sub === "invite" || sub === "all") {
      antiLink.setMode(message.guild.id, sub);
      antiLink.setEnabled(message.guild.id, true);
      return reply(message, "success", `Anti-lien réglé sur **${sub === "all" ? "tous les liens" : "invitations Discord"}**.`);
    }

    const config = antiLink.getConfig(message.guild.id);
    return reply(
      message,
      "info",
      `Anti-lien : **${config.enabled ? "activé" : "désactivé"}** (mode : ${config.mode === "all" ? "tous les liens" : "invitations Discord"}).\n` +
        "Utilise `antilink <on/off>` ou `antilink <invite/all>`."
    );
  },

  async link(client, message, args) {
    if (!can(message.member, PERMISSION)) return;
    const sub = (args[0] || "").toLowerCase();
    const channel = message.mentions.channels?.first() || message.channel;

    if (!["allow", "deny", "reset"].includes(sub)) {
      return reply(message, "error", "Utilise : `link <allow/deny/reset> [#salon]`.");
    }
    if (sub === "reset") {
      antiLink.setChannelAllowed(message.guild.id, channel.id, false);
      return reply(message, "success", `${channel} n'est plus exempté de l'anti-lien.`);
    }
    antiLink.setChannelAllowed(message.guild.id, channel.id, sub === "allow");
    return reply(
      message,
      "success",
      sub === "allow" ? `${channel} est désormais exempté de l'anti-lien.` : `${channel} applique l'anti-lien normalement.`
    );
  },

  async antimassmention(client, message, args) {
    if (!can(message.member, PERMISSION)) return;
    const sub = (args[0] || "").toLowerCase();

    if (sub === "on" || sub === "off") {
      antiMention.setEnabled(message.guild.id, sub === "on");
      return reply(message, "success", `Anti-mass-mention ${sub === "on" ? "activé" : "désactivé"}.`);
    }
    const n = parseInt(sub, 10);
    if (Number.isInteger(n) && n > 0) {
      antiMention.setMaxMentions(message.guild.id, n);
      return reply(message, "success", `Seuil réglé sur **${n} mentions**.`);
    }

    const config = antiMention.getConfig(message.guild.id);
    return reply(
      message,
      "info",
      `Anti-mass-mention : **${config.enabled ? "activé" : "désactivé"}** (seuil : ${config.maxMentions} mentions).\n` +
        "Utilise `antimassmention <on/off>` ou `antimassmention <nombre>`."
    );
  },

  async badwords(client, message, args) {
    if (!can(message.member, PERMISSION)) return;
    const sub = (args[0] || "").toLowerCase();

    if (sub === "on" || sub === "off") {
      badWords.setEnabled(message.guild.id, sub === "on");
      return reply(message, "success", `Filtre de mots interdits ${sub === "on" ? "activé" : "désactivé"}.`);
    }
    if (sub === "add") {
      const word = args.slice(1).join(" ");
      if (!word) return reply(message, "error", "Indique un mot à ajouter.");
      const added = badWords.addWord(message.guild.id, word);
      return reply(message, added ? "success" : "error", added ? `\`${word}\` ajouté à la liste.` : "Ce mot y était déjà.");
    }
    if (sub === "del") {
      const word = args.slice(1).join(" ");
      if (!word) return reply(message, "error", "Indique un mot à retirer.");
      const removed = badWords.removeWord(message.guild.id, word);
      return reply(message, removed ? "success" : "error", removed ? `\`${word}\` retiré de la liste.` : "Ce mot n'y était pas.");
    }
    if (sub === "clear") {
      badWords.clearWords(message.guild.id);
      return reply(message, "success", "Liste de mots interdits vidée.");
    }
    if (sub === "list") {
      const words = badWords.getWords(message.guild.id);
      return reply(message, "info", words.length ? words.map((w) => `\`${w}\``).join(", ") : "Aucun mot dans la liste.");
    }

    const config = badWords.getConfig(message.guild.id);
    return reply(
      message,
      "info",
      `Filtre de mots interdits : **${config.enabled ? "activé" : "désactivé"}**.\nUtilise \`badwords <on/off/add/del/list/clear>\`.`
    );
  },
};

module.exports = { automodHandlers: handlers };
