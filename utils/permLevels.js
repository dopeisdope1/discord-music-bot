// Les 6 niveaux de commande du système de modération (voir `&change`).
const LEVEL = Object.freeze({
  PUBLIC: "public",
  CONFIGURABLE: "configurable",
  CONFIGURABLE_NO_COOLDOWN: "configurableNoCooldown",
  OWNER: "owner",
  SYS: "sys",
  SUPER_SYS: "super_sys",
});

const ALL_LEVELS = Object.freeze(Object.values(LEVEL));

module.exports = { LEVEL, ALL_LEVELS };
