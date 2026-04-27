#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// scripts/cleanup-claimed-sessions.js
// ────────────────────────────────────────────────────────────────
// 一次性清理：删除生产 DB 里历史被 claim 过来的 chat_session（以及对应
// messages）。这些是 sha 9f2e6e7 之前 routes/auth.js::handleVerifyCode
// 还在调 claimAnonSessions 时把匿名 session 转挂到 user_id 上的产物。
//
// b11164f 之后的代码不会再产生这种行，但库里历史的需要手动清。
//
// 判定条件（精准）：
//   user_id IS NOT NULL AND anon_session_id IS NOT NULL
//
// 这是因为 claimAnonSessions 的 UPDATE 只改 user_id，保留 anon_session_id；
// 而正常登录后新建的 session 在 createSession 时只传 userId，
// anon_session_id 始终是 NULL。
//
// 用法（在生产服务器上跑）：
//   cd /root/skill_The_book_of_Elon
//   # 1) 先 dry-run，看要删什么
//   node scripts/cleanup-claimed-sessions.js
//   # 2) 确认无误后真删
//   node scripts/cleanup-claimed-sessions.js --apply
//
// 安全保障：
//   - 默认 dry-run，必须显式 --apply 才真删
//   - 真删之前自动备份 DB 到 ./data/app.db.before-cleanup-<时间戳>
//   - 删除走单个事务，messages 和 chat_sessions 一起删，原子操作
// ════════════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const APPLY = process.argv.includes("--apply");
const DB_PATH = process.env.SQLITE_DB_PATH || "./data/app.db";

if (!fs.existsSync(DB_PATH)) {
  console.error(`✗ DB not found: ${DB_PATH}`);
  process.exit(1);
}

console.log(`${APPLY ? "[APPLY]" : "[DRY-RUN]"} cleanup-claimed-sessions on ${DB_PATH}`);
console.log("");

const db = new Database(DB_PATH);

const targets = db
  .prepare(
    `SELECT id, user_id, anon_session_id, card_id, turn_count,
            datetime(started_at/1000, 'unixepoch') AS started_at_iso,
            datetime(last_active_at/1000, 'unixepoch') AS last_active_iso
     FROM chat_sessions
     WHERE user_id IS NOT NULL AND anon_session_id IS NOT NULL
     ORDER BY id`
  )
  .all();

if (targets.length === 0) {
  console.log("无任何 claimed session — 不需要清理。");
  db.close();
  process.exit(0);
}

console.log(`找到 ${targets.length} 条 claimed sessions：`);
console.log("");
console.log(
  "  " +
    ["id", "user_id", "anon_session_id", "card_id", "turns", "started", "last_active"]
      .map((s) => s.padEnd(s === "anon_session_id" ? 36 : 18))
      .join("")
);
console.log("  " + "─".repeat(160));

let totalMessagesToDelete = 0;
for (const t of targets) {
  const msgCount = db
    .prepare("SELECT COUNT(*) AS c FROM messages WHERE session_id = ?")
    .get(t.id).c;
  totalMessagesToDelete += msgCount;
  console.log(
    "  " +
      [
        String(t.id),
        String(t.user_id),
        String(t.anon_session_id || "").slice(0, 36),
        String(t.card_id || "(null)").slice(0, 16),
        `${t.turn_count} (${msgCount} msgs)`,
        t.started_at_iso,
        t.last_active_iso,
      ]
        .map((s, i) => s.padEnd(i === 2 ? 36 : 18))
        .join("")
  );
}

console.log("");
console.log(`合计要删：${targets.length} sessions + ${totalMessagesToDelete} messages`);

if (!APPLY) {
  console.log("");
  console.log("[DRY-RUN] 无修改。如果确认无误，重跑：");
  console.log("  node scripts/cleanup-claimed-sessions.js --apply");
  db.close();
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const backupPath = `${DB_PATH}.before-cleanup-${stamp}`;
console.log("");
console.log(`▸ 备份 ${DB_PATH} → ${backupPath}`);
fs.copyFileSync(DB_PATH, backupPath);
console.log(`✓ 备份完成 (${(fs.statSync(backupPath).size / 1024).toFixed(1)} KB)`);

console.log("");
console.log("▸ 执行删除（单事务）");
const ids = targets.map((t) => t.id);
const placeholders = ids.map(() => "?").join(",");

const tx = db.transaction(() => {
  const msgRes = db
    .prepare(`DELETE FROM messages WHERE session_id IN (${placeholders})`)
    .run(...ids);
  const sessRes = db
    .prepare(`DELETE FROM chat_sessions WHERE id IN (${placeholders})`)
    .run(...ids);
  return { msg: msgRes.changes, sess: sessRes.changes };
});

const result = tx();
console.log(`✓ 删了 ${result.sess} sessions + ${result.msg} messages`);

const remaining = db
  .prepare(
    `SELECT COUNT(*) AS c FROM chat_sessions
     WHERE user_id IS NOT NULL AND anon_session_id IS NOT NULL`
  )
  .get().c;
console.log("");
console.log(`▸ 验证：当前剩余 claimed sessions = ${remaining}（期望 0）`);
if (remaining !== 0) {
  console.error("✗ 删除后仍有 claimed sessions，可能有 race condition。请检查。");
  db.close();
  process.exit(2);
}

const counts = db
  .prepare(
    `SELECT
       (SELECT COUNT(*) FROM users) AS users,
       (SELECT COUNT(*) FROM chat_sessions) AS sessions,
       (SELECT COUNT(*) FROM messages) AS messages,
       (SELECT COUNT(*) FROM facts) AS facts,
       (SELECT COUNT(*) FROM goals) AS goals`
  )
  .get();
console.log("");
console.log("当前 DB 状态：");
console.log(`  users=${counts.users} chat_sessions=${counts.sessions} messages=${counts.messages} facts=${counts.facts} goals=${counts.goals}`);
console.log("");
console.log(`回滚（万一发现错删）：`);
console.log(`  pm2 stop book-of-elon && cp "${backupPath}" "${DB_PATH}" && pm2 start book-of-elon`);

db.close();
