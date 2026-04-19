// ════════════════════════════════════════════════════════════════
// db/auto-migrate.js
// ────────────────────────────────────────────────────────────────
// 启动时被 db/database.js 调用：检测当前 SQLite 是不是少表/少列，
// 缺什么补什么。补不上就 fail-fast 抛异常，让 PM2 直接退出，
// 总比上线后悄悄丢数据强。
//
// 注意：这里**只**做向前兼容的 ALTER TABLE ADD COLUMN（idempotent）和
// CREATE TABLE IF NOT EXISTS（idempotent）。任何破坏性的 schema 变更
// 必须走 scripts/migrate.js 离线脚本，不要塞进自动迁移。
//
// 设计动机参见 P0 审计 ②③：之前生产 DB 老 schema 缺列时，应用层默默
// 写失败、用户看不到——必须 fail-fast。
// ════════════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");

const SCHEMA_PATH = path.join(__dirname, "schema.sql");

const EXPECTED = {
  tables: [
    "users",
    "goals",
    "facts",
    "chat_sessions",
    "messages",
    "sms_codes",
    "sms_throttle",
    "schema_meta",
  ],
  columns: {
    users: ["total_chat_turns"],
    goals: ["is_current", "archived_at"],
    facts: [
      "pinned",
      "archived",
      "confidence",
      "source_session_id",
      "source_message_id",
    ],
    chat_sessions: ["anon_session_id", "card_id", "turn_count"],
    messages: ["provider", "degraded", "token_count"],
  },
};

const ADD_COLUMN_PATCHES = [
  { table: "users", col: "total_chat_turns", sql: "ALTER TABLE users ADD COLUMN total_chat_turns INTEGER NOT NULL DEFAULT 0" },
  { table: "goals", col: "is_current", sql: "ALTER TABLE goals ADD COLUMN is_current INTEGER NOT NULL DEFAULT 1" },
  { table: "goals", col: "archived_at", sql: "ALTER TABLE goals ADD COLUMN archived_at INTEGER" },
  { table: "messages", col: "provider", sql: "ALTER TABLE messages ADD COLUMN provider TEXT" },
  { table: "messages", col: "degraded", sql: "ALTER TABLE messages ADD COLUMN degraded INTEGER NOT NULL DEFAULT 0" },
  { table: "messages", col: "token_count", sql: "ALTER TABLE messages ADD COLUMN token_count INTEGER" },
  { table: "chat_sessions", col: "card_id", sql: "ALTER TABLE chat_sessions ADD COLUMN card_id TEXT" },
  { table: "chat_sessions", col: "turn_count", sql: "ALTER TABLE chat_sessions ADD COLUMN turn_count INTEGER NOT NULL DEFAULT 0" },
  { table: "chat_sessions", col: "anon_session_id", sql: "ALTER TABLE chat_sessions ADD COLUMN anon_session_id TEXT" },
];

function tableExists(db, name) {
  const r = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);
  return Boolean(r);
}

function columnExists(db, table, col) {
  if (!tableExists(db, table)) return false;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === col);
}

function runAutoMigrate(db, { logger = console } = {}) {
  // 1. CREATE IF NOT EXISTS：把 schema.sql 里所有表先建出来（幂等）
  //    剥掉 PRAGMA — PRAGMA synchronous 不能在 transaction 里改
  const rawSchemaSql = fs.readFileSync(SCHEMA_PATH, "utf8");
  const ddlOnly = rawSchemaSql
    .split("\n")
    .filter((line) => !/^\s*PRAGMA\s/i.test(line))
    .join("\n");

  // schema.sql 在 transaction 外执行更安全（含 CREATE TRIGGER 等）
  db.exec(ddlOnly);

  // 2. ALTER TABLE：补老 DB 缺的列
  const toApply = ADD_COLUMN_PATCHES.filter(
    (p) => tableExists(db, p.table) && !columnExists(db, p.table, p.col)
  );

  if (toApply.length > 0) {
    logger.warn(
      `[auto-migrate] applying ${toApply.length} ALTER TABLE patch(es)`
    );
    const txn = db.transaction(() => {
      for (const p of toApply) {
        db.exec(p.sql);
        logger.warn(`[auto-migrate]   ✓ ${p.sql}`);
      }
    });
    txn();
  }

  // 3. 验证：所有期望的表/列都在
  const stillMissing = { tables: [], columns: [] };
  for (const t of EXPECTED.tables) {
    if (!tableExists(db, t)) stillMissing.tables.push(t);
  }
  for (const [table, cols] of Object.entries(EXPECTED.columns)) {
    if (!tableExists(db, table)) continue;
    for (const c of cols) {
      if (!columnExists(db, table, c)) stillMissing.columns.push(`${table}.${c}`);
    }
  }

  if (stillMissing.tables.length || stillMissing.columns.length) {
    const msg =
      `[auto-migrate] FAIL — schema still incomplete after auto-migrate. ` +
      `missing tables=[${stillMissing.tables.join(",")}] ` +
      `missing columns=[${stillMissing.columns.join(",")}]. ` +
      `Refusing to start. Run \`node scripts/migrate.js --apply\` manually.`;
    throw new Error(msg);
  }

  // 4. 写入 schema_version
  try {
    db.prepare(
      `INSERT INTO schema_meta(key, value, updated_at)
       VALUES('schema_version', '1', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(Date.now());
  } catch (err) {
    logger.warn(`[auto-migrate] could not stamp schema_version: ${err.message}`);
  }

  return {
    appliedPatches: toApply.length,
  };
}

module.exports = {
  runAutoMigrate,
  EXPECTED,
};
