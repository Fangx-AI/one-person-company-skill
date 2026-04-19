const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { runAutoMigrate } = require("./auto-migrate");

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

  // 启动时自动迁移：补老 DB 缺的列。如果补不上、schema 仍不完整，会抛异
  // 常 → PM2 会因启动失败而拒绝服务，胜过悄悄上线后丢数据。
  // 测试环境（NODE_ENV=test）允许跳过，让单元测试更快。
  if (process.env.NODE_ENV !== "test" && process.env.SKIP_AUTO_MIGRATE !== "1") {
    runAutoMigrate(db, {
      logger: {
        warn: (msg) => console.warn(msg),
        info: (msg) => console.info(msg),
      },
    });
  }

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
