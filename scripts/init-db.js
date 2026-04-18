#!/usr/bin/env node
const path = require("path");
const { getDb, getSchemaVersion, DB_PATH, closeDb } = require("../db/database");

function main() {
  console.log("─".repeat(60));
  console.log("Book of Elon — Database Init");
  console.log("─".repeat(60));
  console.log("DB path:", DB_PATH);

  const db = getDb();

  const version = getSchemaVersion();
  console.log("Schema version:", version);

  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    .all()
    .map((row) => row.name)
    .filter((name) => !name.startsWith("sqlite_"));

  console.log("Tables created:");
  for (const name of tables) {
    const count = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get().n;
    console.log(`  - ${name.padEnd(20)} rows=${count}`);
  }

  console.log("─".repeat(60));
  console.log("OK");
  closeDb();
}

main();
