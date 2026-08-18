"use strict";

const blacklistRepo = require("../db/repositories/blacklistRepo");

// CrowBL: cross-guild network list, enforced on join. Called from
// events/guildMemberAdd.event.js, only meaningful for identities that bundle
// the 'bl' category (currently crowgestion).
async function enforceOnJoin(member) {
    const entry = blacklistRepo.globalGet(member.id);
    if (!entry) return false;

    const template =
        blacklistRepo.getDmTemplate(member.guild.id) ||
        "Vous avez été banni automatiquement de ce serveur (liste noire globale). Raison : {reason}";

    await member.send(template.replace("{reason}", entry.reason || "Non spécifiée")).catch(() => {});
    await member.ban({ reason: `Blacklist globale : ${entry.reason || "Aucune raison"}` }).catch(() => {});
    return true;
}

module.exports = { enforceOnJoin };
