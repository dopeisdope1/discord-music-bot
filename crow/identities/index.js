"use strict";

// Une seule identité ici (voir crow.identity.js). Le tableau est conservé car
// commands/public/help.js, commands/public/mesbots.js et
// services/panelService.js font un .find(i => i.key === ...) dessus.
module.exports = [require("./crow.identity")];
