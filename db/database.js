const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DB_DIR = path.join(__dirname, "..", "data");
const DB_PATH = process.env.SQLITE_DB_PATH || path.join(DB_DIR, "app.db");
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

let dbInstance = null;

function getDb() {
  if (dbInstance) return dbInstance;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const db = new Database(DB_PATH);
  applySchema(db);

  dbInstance = db;
  return dbInstance;
}

function applySchema(db) {
  const schemaSql = fs.readFileSync(SCHEMA_PATH, "utf8");
  db.exec(schemaSql);
}

function closeDb() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

function getSchemaVersion() {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'")
    .get();
  return row ? Number(row.value) : 0;
}

module.exports = {
  getDb,
  closeDb,
  getSchemaVersion,
  DB_PATH,
};
