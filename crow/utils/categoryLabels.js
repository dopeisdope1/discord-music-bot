"use strict";

// Libellés et emojis des catégories de commandes (le nom brut est le dossier
// sous crow/commands/). Partagé par public/help.js et public/panel.js pour
// éviter deux tables qui divergent.
const CATEGORY_LABELS = {
    admin: "Administration",
    antiraid: "Anti-Raid",
    giveaway: "Giveaways",
    logs: "Logs",
    moderation: "Modération",
    owner: "Owner",
    gestion: "Gestion",
    public: "Public",
    protect: "Protect",
    limit: "Limit",
    blr: "BLR",
    bl: "Blacklist",
    laisse: "Laisse",
    voice: "Vocal",
};

const CATEGORY_EMOJIS = {
    admin: "🛠️",
    antiraid: "🛡️",
    giveaway: "🎉",
    logs: "📋",
    moderation: "🔨",
    owner: "👑",
    gestion: "📁",
    public: "🌍",
    protect: "🚨",
    limit: "⏱️",
    blr: "🚫",
    bl: "⛔",
    laisse: "⛓️",
    voice: "🔊",
};

const labelOf = (category) => CATEGORY_LABELS[category] || category;
const emojiOf = (category) => CATEGORY_EMOJIS[category] || "📦";

module.exports = { CATEGORY_LABELS, CATEGORY_EMOJIS, labelOf, emojiOf };
