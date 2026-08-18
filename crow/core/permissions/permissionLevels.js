"use strict";

const LEVEL = Object.freeze({
    NONE: 0,
    STAFF: 1,
    MOD: 2,
    ADMIN: 3,
});

const LEVEL_NAMES = Object.freeze({
    0: "Public",
    1: "Staff",
    2: "Mod",
    3: "Admin",
});

module.exports = { LEVEL, LEVEL_NAMES };
