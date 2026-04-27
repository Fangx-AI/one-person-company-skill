// ════════════════════════════════════════════════════════════════
// scripts/migrate.js
// ────────────────────────────────────────────────────────────────
// 把生产 DB 升级到当前 schema。幂等：跑多少次都安全。
//
// 策略：
//   1. 列出所有需要存在的表 + 关键新增列
//   2. 用 PRAGMA table_info 检查现状
//   3. 缺什么补什么，已有就跳过
//   4. 最后跑一次 schema.sql（CREATE IF NOT EXISTS 都是安全的）
//   5. 写 schema_version
//
// 用法：
//   node scripts/migrate.js              -- dry-run，只报告不动 DB
//   node scripts/migrate.js --apply      -- 真执行
//   SQLITE_DB_PATH=./data/app.db node scripts/migrate.js --apply
// ════════════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const DRY = !process.argv.includes("--apply");
const DB_PATH =
  process.env.SQLITE_DB_PATH || path.join(__dirname, "..", "..", "data", "app.db");
const SCHEMA_PATH = path.join(__dirname, "..", "..", "db", "schema.sql");

if (!fs.existsSync(DB_PATH)) {
  console.error(`DB not found: ${DB_PATH}`);
  console.error("Nothing to migrate. Run scripts/init-db.js to create from scratch.");
  process.exit(2);
}

console.log(`${DRY ? "[DRY-RUN]" : "[APPLY]"} migrating ${DB_PATH}`);

// 备份 — 永远在 apply 前自动复制一份
if (!DRY) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const backupPath = `${DB_PATH}.backup-${stamp}`;
  fs.copyFileSync(DB_PATH, backupPath);
  console.log(`backup -> ${backupPath}`);
}

const db = new Database(DB_PATH);

// ───────── 检查表/列 ─────────
function tableExists(name) {
  const r = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
    )
    .get(name);
  return Boolean(r);
}

function columnExists(table, col) {
  if (!tableExists(table)) return false;
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  return cols.some((c) => c.name === col);
}

// 期望存在的 schema 元素（v1 全部）
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
    facts: ["pinned", "archived", "confidence", "source_session_id", "source_message_id"],
    chat_sessions: ["anon_session_id", "card_id", "turn_count"],
    messages: ["provider", "degraded", "token_count"],
  },
};

const missing = { tables: [], columns: [] };
for (const t of EXPECTED.tables) {
  if (!tableExists(t)) missing.tables.push(t);
}
for (const [table, cols] of Object.entries(EXPECTED.columns)) {
  if (!tableExists(table)) continue;
  for (const c of cols) {
    if (!columnExists(table, c)) {
      missing.columns.push(`${table}.${c}`);
    }
  }
}

console.log(`\nbefore migration:`);
console.log(`  missing tables : ${missing.tables.length ? missing.tables.join(", ") : "(none)"}`);
console.log(`  missing columns: ${missing.columns.length ? missing.columns.join(", ") : "(none)"}`);

// ───────── 关键列 ALTER TABLE 兼容老 DB ─────────
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

const toApply = ADD_COLUMN_PATCHES.filter(
  (p) => tableExists(p.table) && !columnExists(p.table, p.col)
);

console.log(`\nALTER TABLE patches to apply: ${toApply.length}`);
for (const p of toApply) {
  console.log(`  ${p.sql}`);
}

if (DRY) {
  // dry-run 不跑 schema.sql 也不写入
  console.log("\n[DRY-RUN] not touching DB. Re-run with --apply.");
  db.close();
  process.exit(0);
}

// ───────── 执行 ─────────
// schema.sql 顶头有 PRAGMA synchronous=NORMAL 等，这种 PRAGMA 不能在
// transaction 里改 (SQLITE_ERROR: Safety level may not be changed inside
// a transaction)。把它从 SQL 里剥掉，PRAGMA 留给 db/database.js 在 getDb()
// 时设置即可。
const rawSchemaSql = fs.readFileSync(SCHEMA_PATH, "utf8");
const ddlOnlySchemaSql = rawSchemaSql
  .split("\n")
  .filter((line) => !/^\s*PRAGMA\s/i.test(line))
  .join("\n");

const txn = db.transaction(() => {
  for (const p of toApply) {
    db.exec(p.sql);
    console.log(`  ✓ ${p.sql}`);
  }
  // 跑 schema.sql：所有 CREATE 都是 IF NOT EXISTS，幂等
  db.exec(ddlOnlySchemaSql);
  console.log("  ✓ schema.sql applied (idempotent, PRAGMAs skipped)");

  // 显式更新 schema_version
  db.prepare(
    `INSERT INTO schema_meta(key, value, updated_at)
     VALUES('schema_version', '1', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(Date.now());
});
txn();

// ───────── 验证 ─────────
const after = { tables: [], columns: [] };
for (const t of EXPECTED.tables) {
  if (!tableExists(t)) after.tables.push(t);
}
for (const [table, cols] of Object.entries(EXPECTED.columns)) {
  for (const c of cols) {
    if (!columnExists(table, c)) after.columns.push(`${table}.${c}`);
  }
}

console.log(`\nafter migration:`);
console.log(`  missing tables : ${after.tables.length ? after.tables.join(", ") : "(none)"}`);
console.log(`  missing columns: ${after.columns.length ? after.columns.join(", ") : "(none)"}`);

if (after.tables.length || after.columns.length) {
  console.error("\nFAIL: schema still incomplete after migration.");
  db.close();
  process.exit(1);
}

console.log("\nDONE.");
db.close();
