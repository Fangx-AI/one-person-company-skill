#!/usr/bin/env node
// ============================================================
// scripts/admin-report.js
// ------------------------------------------------------------
// 在终端打印一份后台对话数据的纯文本报告（PII 脱敏）。
//
// 用法：
//   node scripts/admin-report.js                 # 打印到 stdout
//   node scripts/admin-report.js | less -R       # 分页查看（推荐）
//   node scripts/admin-report.js > /tmp/r.txt    # 写文件后再看
//
// 说明：
//   - 只读打开数据库，不修改任何记录
//   - 手机号脱敏（前 3 + **** + 后 4），匿名 session_id 截断
//   - 自动检测 data/app.db, data/site.db, data/production.db
//   - 也接受 SQLITE_DB_PATH 环境变量指定路径
// ============================================================

"use strict";

const fs = require("fs");
const path = require("path");

let Database;
try {
  Database = require("better-sqlite3");
} catch (err) {
  console.error("[admin-report] better-sqlite3 加载失败:", err.message);
  console.error("[admin-report] 提示: 在仓库根目录跑过 npm rebuild better-sqlite3 吗?");
  process.exit(1);
}

// ---------- 0. 定位数据库 ----------
const projectRoot = path.resolve(__dirname, "..", "..");
function resolveDbPath() {
  const fromEnv = process.env.SQLITE_DB_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  const candidates = ["data/app.db", "data/site.db", "data/production.db"];
  for (const rel of candidates) {
    const abs = path.join(projectRoot, rel);
    if (fs.existsSync(abs)) return abs;
  }
  const dataDir = path.join(projectRoot, "data");
  if (fs.existsSync(dataDir)) {
    const found = fs
      .readdirSync(dataDir)
      .filter((f) => f.endsWith(".db"))
      .map((f) => path.join(dataDir, f));
    if (found.length > 0) return found[0];
  }
  return null;
}

const dbPath = resolveDbPath();
if (!dbPath) {
  console.error("[admin-report] 未找到数据库文件 (查找了 data/app.db, site.db, production.db)");
  process.exit(2);
}
console.error("[admin-report] 使用数据库:", dbPath);

const db = new Database(dbPath, { readonly: true });

// ---------- 1. 工具函数 ----------
function maskPhone(p) {
  if (!p) return "(无)";
  const s = String(p);
  if (s.length < 7) return "***";
  return s.slice(0, 3) + "****" + s.slice(-4);
}
function fmtTime(ms) {
  if (!ms) return "-";
  const d = new Date(Number(ms));
  if (isNaN(d.getTime())) return "-";
  return d.toISOString().replace("T", " ").slice(0, 19);
}
function trunc(s, n) {
  n = n || 300;
  return (s || "").replace(/\s+/g, " ").slice(0, n);
}
function safeCount(sql, params) {
  try {
    return db.prepare(sql).get(...(params || [])).c;
  } catch (e) {
    return -1;
  }
}

const out = [];
const w = (line) => out.push(line == null ? "" : String(line));

// ---------- 2. 报告内容 ----------
w("==========================================");
w("   Book of Elon · 后台对话数据报告");
w("==========================================");
w("生成时间: " + new Date().toISOString());
w("数据库:   " + dbPath);
w("");

const totalUsers = safeCount("SELECT count(*) c FROM users");
const totalSess = safeCount("SELECT count(*) c FROM chat_sessions");
const authSess = safeCount("SELECT count(*) c FROM chat_sessions WHERE user_id IS NOT NULL");
const anonSess = totalSess - authSess;
const totalMsgs = safeCount("SELECT count(*) c FROM messages");
const userMsgs = safeCount("SELECT count(*) c FROM messages WHERE role='user'");
const aiMsgs = safeCount("SELECT count(*) c FROM messages WHERE role='assistant'");
const fbMsgs = safeCount("SELECT count(*) c FROM messages WHERE degraded=1");
const totalFacts = safeCount("SELECT count(*) c FROM facts");
const totalGoals = safeCount("SELECT count(*) c FROM goals");

w("## 概览");
w("  注册用户:    " + totalUsers);
w("  总会话数:    " + totalSess + " (登录 " + authSess + " / 匿名 " + anonSess + ")");
w("  总消息数:    " + totalMsgs + " (用户 " + userMsgs + " / AI " + aiMsgs + ")");
w("  fallback 数: " + fbMsgs + " (未走 LLM 的降级回复)");
w("  Facts:       " + totalFacts);
w("  Goals:       " + totalGoals);
w("");

// ---------- 注册用户列表 ----------
const userList = db.prepare("SELECT * FROM users ORDER BY created_at").all();
w("## 注册用户");
if (userList.length === 0) w("  (无)");
userList.forEach((u) => {
  const sCnt = safeCount("SELECT count(*) c FROM chat_sessions WHERE user_id=?", [u.id]);
  const mCnt = safeCount(
    "SELECT count(*) c FROM messages m JOIN chat_sessions s ON m.session_id=s.id WHERE s.user_id=?",
    [u.id],
  );
  w(
    "  [#" +
      u.id +
      "] " +
      maskPhone(u.phone) +
      " | name=" +
      (u.display_name || "-") +
      " | created=" +
      fmtTime(u.created_at) +
      " | last_seen=" +
      fmtTime(u.last_seen_at) +
      " | sessions=" +
      sCnt +
      " | messages=" +
      mCnt +
      " | turns=" +
      u.total_chat_turns,
  );
});
w("");

// ---------- 每个登录用户的完整对话 ----------
w("## 每个登录用户的完整对话");
const SQL_USER_MSGS =
  "SELECT m.id, m.role, m.content, m.created_at, m.degraded, m.provider, " +
  "       s.id sid, s.card_id, s.started_at " +
  "FROM messages m JOIN chat_sessions s ON m.session_id=s.id " +
  "WHERE s.user_id=? ORDER BY m.created_at, m.id";
userList.forEach((u) => {
  w("");
  w("========================================");
  w("  用户 #" + u.id + "  " + maskPhone(u.phone));
  w("========================================");
  const um = db.prepare(SQL_USER_MSGS).all(u.id);
  if (um.length === 0) {
    w("  (无消息)");
    return;
  }
  let lastSid = null;
  um.forEach((m) => {
    if (m.sid !== lastSid) {
      w("");
      w(
        "  --- 会话 #" +
          m.sid +
          (m.card_id ? " (card=" + m.card_id + ")" : "") +
          " 起=" +
          fmtTime(m.started_at) +
          " ---",
      );
      lastSid = m.sid;
    }
    const flag = m.degraded ? " [FALLBACK]" : "";
    const prov = m.provider ? "/" + m.provider : "";
    w("  [" + fmtTime(m.created_at) + "] " + m.role + flag + prov + ":");
    w("    " + trunc(m.content, 600));
  });
});

// ---------- 匿名会话 TOP ----------
w("");
w("## 匿名会话 TOP 30（按消息数降序）");
const SQL_ANON =
  "SELECT s.id, s.anon_session_id, s.card_id, s.started_at, s.last_active_at, s.turn_count, " +
  "       (SELECT count(*) FROM messages WHERE session_id=s.id) msgs " +
  "FROM chat_sessions s WHERE s.user_id IS NULL " +
  "ORDER BY msgs DESC, s.last_active_at DESC LIMIT 30";
const anonRows = db.prepare(SQL_ANON).all();
if (anonRows.length === 0) w("  (无)");
anonRows.forEach((r) => {
  w(
    "  #" +
      r.id +
      "  anon=" +
      (r.anon_session_id || "").slice(0, 12) +
      "...  card=" +
      (r.card_id || "-") +
      "  msgs=" +
      r.msgs +
      "  last=" +
      fmtTime(r.last_active_at),
  );
});

// ---------- 最近 50 条消息（含匿名） ----------
w("");
w("## 最近 50 条消息（含匿名，按时间正序）");
const SQL_RECENT =
  "SELECT m.id, m.role, m.content, m.created_at, m.degraded, m.provider, " +
  "       s.user_id, s.anon_session_id, s.id sid " +
  "FROM messages m JOIN chat_sessions s ON m.session_id=s.id " +
  "ORDER BY m.created_at DESC, m.id DESC LIMIT 50";
const recent = db.prepare(SQL_RECENT).all();
if (recent.length === 0) w("  (无)");
recent.reverse().forEach((m) => {
  const who = m.user_id ? "user#" + m.user_id : "anon[" + (m.anon_session_id || "?").slice(0, 8) + "]";
  const flag = m.degraded ? " [FALLBACK]" : "";
  w(
    "  [" +
      fmtTime(m.created_at) +
      "] sess#" +
      m.sid +
      " " +
      who +
      " " +
      m.role +
      flag +
      ": " +
      trunc(m.content, 350),
  );
});

// ---------- Facts ----------
w("");
w("## Facts（AI 自动抽取的关键事实）");
const facts = db.prepare("SELECT * FROM facts ORDER BY user_id, created_at").all();
if (facts.length === 0) w("  (无)");
facts.forEach((f) => {
  w(
    "  [user#" +
      f.user_id +
      "] " +
      f.kind +
      " (conf=" +
      (f.confidence == null ? "-" : f.confidence.toFixed(2)) +
      ")" +
      (f.archived ? " [archived]" : "") +
      (f.pinned ? " [pinned]" : "") +
      ": " +
      trunc(f.text, 300),
  );
});

// ---------- Goals ----------
w("");
w("## Goals（北极星）");
const goals = db.prepare("SELECT * FROM goals ORDER BY user_id, created_at").all();
if (goals.length === 0) w("  (无)");
goals.forEach((g) => {
  w(
    "  [user#" +
      g.user_id +
      "] " +
      (g.is_current ? "[CURRENT] " : "") +
      "created=" +
      fmtTime(g.created_at) +
      ": " +
      trunc(g.north_star, 300),
  );
});

w("");
w("==========================================");
w("              报告结束");
w("==========================================");

db.close();

// ---------- 输出 ----------
process.stdout.write(out.join("\n") + "\n");
