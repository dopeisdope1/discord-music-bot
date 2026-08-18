"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

// DATA_DIR pointe sur le Volume Railway monté (/data) : le disque du conteneur
// est réinitialisé à chaque redéploiement, donc sans ça toute la base (permissions,
// sanctions, config des guards, giveaways...) serait perdue à chaque push.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "..", "data");
const DB_PATH = path.join(DATA_DIR, "bot.sqlite");

let instance = null;
function getDb() {
    if (instance) return instance;

    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    instance = new DatabaseSync(DB_PATH);
    instance.exec("PRAGMA journal_mode = WAL;");
    instance.exec("PRAGMA foreign_keys = ON;");

    return instance;
}

module.exports = { getDb, DB_PATH };
