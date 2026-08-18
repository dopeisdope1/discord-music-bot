"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { getDb } = require("./connection");

const MIGRATIONS_DIR = path.join(__dirname, "migrations");

function ensureMigrationsTable(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            name TEXT PRIMARY KEY,
            applied_at INTEGER NOT NULL
        );
    `);
}

function run() {
    const db = getDb();
    ensureMigrationsTable(db);

    const applied = new Set(
        db.prepare("SELECT name FROM schema_migrations").all().map((row) => row.name)
    );

    const files = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith(".sql"))
        .sort();

    for (const file of files) {
        if (applied.has(file)) continue;

        const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");

        db.exec("BEGIN");
        try {
            db.exec(sql);
            db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(
                file,
                Date.now()
            );
            db.exec("COMMIT");
            console.log(`[migrate] applied ${file}`);
        } catch (error) {
            db.exec("ROLLBACK");
            throw new Error(`Migration ${file} failed: ${error.message}`);
        }
    }
}

module.exports = { run };
