#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// scripts/export-admin-snapshot.js
// ────────────────────────────────────────────────────────────────
// 把生产数据库的全部对话/用户/事实数据导出成一个单文件 HTML，
// 用作"临时管理后台"。
//
// 设计原则（跟 ARMS / 在线后台路线**对立**）：
//   1. 零端口暴露：不开 HTTP server、不监听任何端口
//   2. 零持久化：写到 /tmp/，看完删除即可
//   3. PII 脱敏：手机号一律 138****1234（不可逆），即使你截图发
//      给别人也不会暴露完整号码
//   4. 文件权限 0600：只 root 可读，防止服务器上其他用户看到
//   5. 不进 git：scripts/ 下的 .gitignore 已经覆盖 /tmp/* 用法
//
// 用法：
//   sudo -i
//   cd /root/skill_The_book_of_Elon
//   node scripts/export-admin-snapshot.js [output_path]
//
// 默认输出 /tmp/admin-snapshot.html，~5–20 MB（取决于消息数量）。
// 然后用阿里云 Workbench 的"文件传输"功能下载到本地浏览器打开。
// ════════════════════════════════════════════════════════════════

const fs = require("fs");
const path = require("path");
const os = require("os");
const Database = require("better-sqlite3");

const OUT_PATH = process.argv[2] || "/tmp/admin-snapshot.html";
const MAX_MESSAGES = Number(process.env.SNAPSHOT_MAX_MESSAGES || 30000);
const MAX_SESSIONS = Number(process.env.SNAPSHOT_MAX_SESSIONS || 10000);

function resolveDbPath() {
  const dataDir = path.join(__dirname, "..", "data");
  const candidates = [
    process.env.SQLITE_DB_PATH,
    path.join(dataDir, "app.db"),
    path.join(dataDir, "site.db"),
    path.join(dataDir, "production.db"),
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  if (fs.existsSync(dataDir)) {
    const dbFiles = fs
      .readdirSync(dataDir)
      .filter((f) => f.endsWith(".db") && !f.includes("test"))
      .map((f) => path.join(dataDir, f));
    if (dbFiles.length) return dbFiles[0];
  }

  return null;
}

const DB_PATH = resolveDbPath();
if (!DB_PATH) {
  console.error("[snapshot] No SQLite database found.");
  console.error("[snapshot] Tried: $SQLITE_DB_PATH, data/app.db, data/site.db, data/production.db");
  console.error("[snapshot] Run from project root, or set SQLITE_DB_PATH explicitly.");
  process.exit(1);
}
console.log("[snapshot] Using database:", DB_PATH);

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
const now = Date.now();

function maskPhone(phone) {
  const s = String(phone || "").replace(/\D/g, "");
  if (s.length < 7) return "***";
  return s.slice(0, 3) + "****" + s.slice(-4);
}

function maskAnon(anonId) {
  const s = String(anonId || "");
  if (s.length < 12) return s;
  return s.slice(0, 8) + "…" + s.slice(-4);
}

const totals = {
  users: db.prepare("SELECT COUNT(*) c FROM users").get().c,
  sessions: db.prepare("SELECT COUNT(*) c FROM chat_sessions").get().c,
  sessionsAuth: db
    .prepare("SELECT COUNT(*) c FROM chat_sessions WHERE user_id IS NOT NULL")
    .get().c,
  sessionsAnon: db
    .prepare("SELECT COUNT(*) c FROM chat_sessions WHERE user_id IS NULL")
    .get().c,
  messages: db.prepare("SELECT COUNT(*) c FROM messages").get().c,
  msgUser: db
    .prepare("SELECT COUNT(*) c FROM messages WHERE role='user'")
    .get().c,
  msgAi: db
    .prepare("SELECT COUNT(*) c FROM messages WHERE role='assistant'")
    .get().c,
  msgDegraded: db
    .prepare("SELECT COUNT(*) c FROM messages WHERE degraded=1")
    .get().c,
  facts: db.prepare("SELECT COUNT(*) c FROM facts").get().c,
  goals: db.prepare("SELECT COUNT(*) c FROM goals").get().c,
};

const users = db
  .prepare(
    `SELECT id, phone, display_name, created_at, last_seen_at, total_chat_turns
     FROM users ORDER BY last_seen_at DESC`
  )
  .all()
  .map((u) => ({
    id: u.id,
    phone: maskPhone(u.phone),
    displayName: u.display_name || "",
    createdAt: u.created_at,
    lastSeenAt: u.last_seen_at,
    totalChatTurns: u.total_chat_turns || 0,
  }));

const sessions = db
  .prepare(
    `SELECT id, user_id, anon_session_id, card_id, started_at, last_active_at, turn_count
     FROM chat_sessions ORDER BY last_active_at DESC LIMIT ?`
  )
  .all(MAX_SESSIONS)
  .map((s) => ({
    id: s.id,
    userId: s.user_id,
    anonSessionId: s.anon_session_id ? maskAnon(s.anon_session_id) : null,
    cardId: s.card_id || "",
    startedAt: s.started_at,
    lastActiveAt: s.last_active_at,
    turnCount: s.turn_count || 0,
  }));

const messages = db
  .prepare(
    `SELECT id, session_id, role, content, turn_index, created_at,
            provider, degraded, token_count
     FROM messages ORDER BY created_at DESC LIMIT ?`
  )
  .all(MAX_MESSAGES)
  .map((m) => ({
    id: m.id,
    sessionId: m.session_id,
    role: m.role,
    content: m.content,
    turnIndex: m.turn_index,
    createdAt: m.created_at,
    provider: m.provider || "",
    degraded: !!m.degraded,
    tokenCount: m.token_count || 0,
  }));

const facts = db
  .prepare(
    `SELECT id, user_id, kind, text, source_session_id, pinned, archived,
            confidence, created_at
     FROM facts ORDER BY created_at DESC`
  )
  .all();

const goals = db
  .prepare(
    `SELECT id, user_id, north_star, is_current, created_at, archived_at
     FROM goals ORDER BY created_at DESC`
  )
  .all();

const sixtyDaysAgoMs = now - 60 * 86400 * 1000;
const msgByDay = db
  .prepare(
    `SELECT date(created_at / 1000, 'unixepoch') d, role, COUNT(*) c
     FROM messages WHERE created_at >= ?
     GROUP BY d, role ORDER BY d`
  )
  .all(sixtyDaysAgoMs);

const data = {
  meta: {
    generatedAt: now,
    host: os.hostname(),
    db: DB_PATH,
    truncatedMessages: messages.length >= MAX_MESSAGES,
    truncatedSessions: sessions.length >= MAX_SESSIONS,
  },
  totals,
  users,
  sessions,
  messages,
  facts,
  goals,
  msgByDay,
};

// 内嵌进 <script> 标签时要防 </script> 被 break
const json = JSON.stringify(data).replace(/<\/script/gi, "<\\/script");

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;">
<title>The Book of Elon — Admin Snapshot</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #0a0f18;
    --panel: #111a26;
    --panel-soft: #18243a;
    --border: rgba(170, 194, 255, 0.14);
    --border-strong: rgba(170, 194, 255, 0.28);
    --text: #f0f4ff;
    --soft: rgba(232, 238, 255, 0.7);
    --ok: #54d18f;
    --warn: #ffb65c;
    --danger: #ff7d87;
    --accent: #a9c4ff;
    --user-bubble: #1f3556;
    --ai-bubble: #1c2330;
    --fallback-bubble: #3d2a1f;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif;
    background: var(--bg); color: var(--text);
    line-height: 1.55;
  }
  .topbar {
    padding: 16px 24px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    display: flex; justify-content: space-between; align-items: center;
    flex-wrap: wrap; gap: 12px;
  }
  .topbar h1 { margin: 0; font-size: 20px; font-weight: 700; }
  .topbar .meta { color: var(--soft); font-size: 12px; }
  .warning {
    background: rgba(255, 125, 135, 0.12);
    border: 1px solid rgba(255, 125, 135, 0.4);
    color: #ffd0d4;
    padding: 10px 16px;
    margin: 12px 24px;
    border-radius: 10px;
    font-size: 13px;
  }
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
    padding: 16px 24px;
  }
  .stat {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 12px 14px;
  }
  .stat .label { color: var(--soft); font-size: 12px; }
  .stat .value { font-size: 22px; font-weight: 700; margin-top: 4px; }
  .stat .sub { color: var(--soft); font-size: 11px; margin-top: 2px; }

  .tabs {
    display: flex; gap: 4px;
    padding: 0 24px;
    border-bottom: 1px solid var(--border);
    overflow-x: auto;
  }
  .tab {
    padding: 12px 16px;
    cursor: pointer;
    color: var(--soft);
    border-bottom: 2px solid transparent;
    white-space: nowrap;
    user-select: none;
    font-size: 14px;
  }
  .tab:hover { color: var(--text); }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }

  .panel-content { padding: 16px 24px; }

  .layout {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 16px;
    min-height: 600px;
  }
  @media (max-width: 920px) {
    .layout { grid-template-columns: 1fr; }
  }

  .list-pane {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    overflow: hidden;
    max-height: 75vh;
    display: flex; flex-direction: column;
  }
  .list-search {
    padding: 10px;
    border-bottom: 1px solid var(--border);
  }
  .list-search input {
    width: 100%;
    padding: 8px 10px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 8px;
    font-size: 13px;
    outline: none;
  }
  .list-search input:focus { border-color: var(--accent); }
  .list-items { overflow-y: auto; flex: 1; }
  .list-item {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
    font-size: 13px;
  }
  .list-item:hover { background: rgba(255,255,255,0.02); }
  .list-item.active { background: rgba(169, 196, 255, 0.08); border-left: 3px solid var(--accent); padding-left: 9px; }
  .list-item .head { display: flex; justify-content: space-between; gap: 8px; }
  .list-item .name { font-weight: 600; }
  .list-item .badge { color: var(--soft); font-size: 11px; }
  .list-item .sub { color: var(--soft); font-size: 11px; margin-top: 2px; }

  .detail-pane {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px;
    overflow-y: auto;
    max-height: 75vh;
  }
  .session-card {
    background: var(--panel-soft);
    border: 1px solid var(--border);
    border-radius: 10px;
    margin-bottom: 12px;
    overflow: hidden;
  }
  .session-head {
    padding: 10px 14px;
    cursor: pointer;
    display: flex; justify-content: space-between; align-items: center;
    user-select: none;
  }
  .session-head:hover { background: rgba(255,255,255,0.02); }
  .session-head .left { display: flex; flex-direction: column; gap: 2px; }
  .session-head .title { font-weight: 600; font-size: 13px; }
  .session-head .meta { color: var(--soft); font-size: 11px; }
  .session-head .right { color: var(--soft); font-size: 11px; }
  .session-body { padding: 12px 14px; border-top: 1px solid var(--border); display: none; }
  .session-card.open .session-body { display: block; }

  .msg {
    padding: 10px 14px;
    border-radius: 10px;
    margin-bottom: 10px;
    max-width: 85%;
    word-wrap: break-word;
    white-space: pre-wrap;
    font-size: 14px;
  }
  .msg.user { background: var(--user-bubble); margin-left: auto; }
  .msg.assistant { background: var(--ai-bubble); }
  .msg.assistant.fallback { background: var(--fallback-bubble); border: 1px dashed rgba(255, 182, 92, 0.5); }
  .msg .msg-meta {
    color: var(--soft); font-size: 10px; margin-top: 6px;
    display: flex; gap: 8px; flex-wrap: wrap;
  }
  .msg .role-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 700;
    margin-bottom: 4px;
  }
  .msg.user .role-badge { background: var(--accent); color: #0a0f18; }
  .msg.assistant .role-badge { background: var(--ok); color: #0a0f18; }
  .msg.assistant.fallback .role-badge { background: var(--warn); color: #0a0f18; }

  .empty { color: var(--soft); padding: 24px; text-align: center; font-size: 13px; }
  .pill {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 4px;
    font-size: 10px;
    background: rgba(255,255,255,0.05);
    border: 1px solid var(--border);
    color: var(--soft);
  }
  .pill.warn { background: rgba(255, 182, 92, 0.12); border-color: rgba(255, 182, 92, 0.4); color: #ffd6a5; }
  .pill.ok { background: rgba(84, 209, 143, 0.12); border-color: rgba(84, 209, 143, 0.4); color: #a8e6c2; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  table th, table td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--border); }
  table th { color: var(--soft); font-weight: 600; }
  table tr:hover td { background: rgba(255,255,255,0.02); }

  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; }
  .kind-tag {
    display: inline-block; padding: 2px 8px; border-radius: 4px;
    font-size: 11px; font-weight: 600; margin-right: 6px;
  }
  .kind-intend { background: #1f3556; color: #b3d0ff; }
  .kind-blocker { background: #3d1f25; color: #ffb3b3; }
  .kind-deadline { background: #3d2a1f; color: #ffd6a5; }
  .kind-done { background: #1f3d29; color: #a8e6c2; }
  .kind-belief { background: #2a1f3d; color: #d6b3ff; }
</style>
</head>
<body>

<div class="topbar">
  <div>
    <h1>📚 The Book of Elon — Admin Snapshot</h1>
    <div class="meta" id="meta-line"></div>
  </div>
  <div>
    <span class="pill" id="truncated-warn" style="display:none">数据被截断（原始量更大）</span>
  </div>
</div>

<div class="warning">
  <strong>⚠️ PII 警告</strong>：此文件包含真实用户对话内容。手机号已脱敏成 <code>138****1234</code> 但**对话原文未脱敏**。
  <br>看完请<strong>立即删除本文件</strong>，不要上传任何云盘 / 聊天工具 / git 仓库。
</div>

<div class="stats" id="stats"></div>

<div class="tabs" id="tabs"></div>
<div id="view"></div>

<script>
const DATA = ${json};
const $ = (id) => document.getElementById(id);
const escape = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtCount = (n) => Number(n || 0).toLocaleString("en-US");
const fmtTime = (ms) => {
  if (!ms) return "—";
  const d = new Date(Number(ms));
  return d.toLocaleString("zh-CN", { hour12: false });
};
const fmtDate = (ms) => {
  if (!ms) return "—";
  return new Date(Number(ms)).toLocaleDateString("zh-CN");
};
const fmtRel = (ms) => {
  if (!ms) return "—";
  const diff = Date.now() - Number(ms);
  const s = Math.floor(diff / 1000);
  if (s < 60) return s + "s ago";
  if (s < 3600) return Math.floor(s/60) + "m ago";
  if (s < 86400) return Math.floor(s/3600) + "h ago";
  return Math.floor(s/86400) + "d ago";
};

// 检测 fallback 模板（这些固定字符串来自 server.js::getFallbackIntro）
const FALLBACK_PHRASES = [
  "现在对话通道有点挤",
  "当前对话请求有点密",
  "模型刚刚响应有点慢",
  "我先按本地知识模式陪你往下拆"
];
function isFallbackContent(s) {
  if (!s) return false;
  return FALLBACK_PHRASES.some(p => s.includes(p));
}

// ===== 顶部 ======
$("meta-line").textContent =
  "导出时间 " + fmtTime(DATA.meta.generatedAt) +
  " | 主机 " + DATA.meta.host +
  " | DB " + DATA.meta.db;

if (DATA.meta.truncatedMessages || DATA.meta.truncatedSessions) {
  $("truncated-warn").style.display = "inline-block";
}

// ===== Stats ======
const t = DATA.totals;
const fallbackCount = DATA.messages.filter(m => m.role === "assistant" && (m.degraded || isFallbackContent(m.content))).length;
const realAi = DATA.messages.filter(m => m.role === "assistant" && !m.degraded && !isFallbackContent(m.content)).length;

$("stats").innerHTML = [
  ['注册用户', fmtCount(t.users)],
  ['总会话', fmtCount(t.sessions), \`登录 \${fmtCount(t.sessionsAuth)} · 匿名 \${fmtCount(t.sessionsAnon)}\`],
  ['总消息', fmtCount(t.messages), \`user \${fmtCount(t.msgUser)} · ai \${fmtCount(t.msgAi)}\`],
  ['本次导出消息', fmtCount(DATA.messages.length), DATA.meta.truncatedMessages ? '已截断到上限' : '全量'],
  ['真实 AI 回复', fmtCount(realAi), '走 DeepSeek 成功'],
  ['Fallback 回复', fmtCount(fallbackCount), '降级 / 模板'],
  ['抽取事实', fmtCount(t.facts)],
  ['北极星目标', fmtCount(t.goals)]
].map(([label, value, sub]) =>
  \`<div class="stat">
    <div class="label">\${escape(label)}</div>
    <div class="value">\${escape(value)}</div>
    \${sub ? \`<div class="sub">\${escape(sub)}</div>\` : ""}
  </div>\`
).join("");

// ===== Tabs ======
const TABS = [
  { id: "users", label: "👥 注册用户" },
  { id: "anon", label: "🔓 匿名会话" },
  { id: "recent", label: "🕒 最近消息" },
  { id: "fallback", label: "⚠️ Fallback 回复" },
  { id: "facts", label: "🔍 Facts" },
  { id: "goals", label: "⭐ Goals" },
  { id: "longest", label: "📏 最长会话（成本大户）" }
];
let activeTab = "users";

$("tabs").innerHTML = TABS.map(t =>
  \`<div class="tab" data-tab="\${t.id}">\${t.label}</div>\`
).join("");
$("tabs").querySelectorAll(".tab").forEach(el => {
  el.addEventListener("click", () => {
    activeTab = el.dataset.tab;
    render();
  });
});

// ===== 全局 index ======
const sessionsByUser = new Map();
const sessionsByAnon = [];
DATA.sessions.forEach(s => {
  if (s.userId) {
    if (!sessionsByUser.has(s.userId)) sessionsByUser.set(s.userId, []);
    sessionsByUser.get(s.userId).push(s);
  } else {
    sessionsByAnon.push(s);
  }
});
const messagesBySession = new Map();
DATA.messages.forEach(m => {
  if (!messagesBySession.has(m.sessionId)) messagesBySession.set(m.sessionId, []);
  messagesBySession.get(m.sessionId).push(m);
});
messagesBySession.forEach(arr => arr.sort((a,b) => a.turnIndex - b.turnIndex));

const userById = new Map(DATA.users.map(u => [u.id, u]));

// ===== 渲染 ======
function render() {
  document.querySelectorAll(".tab").forEach(el => {
    el.classList.toggle("active", el.dataset.tab === activeTab);
  });
  const view = $("view");
  if (activeTab === "users") view.innerHTML = renderUsersTab();
  else if (activeTab === "anon") view.innerHTML = renderAnonTab();
  else if (activeTab === "recent") view.innerHTML = renderRecentTab();
  else if (activeTab === "fallback") view.innerHTML = renderFallbackTab();
  else if (activeTab === "facts") view.innerHTML = renderFactsTab();
  else if (activeTab === "goals") view.innerHTML = renderGoalsTab();
  else if (activeTab === "longest") view.innerHTML = renderLongestTab();
  bindInteractions();
}

let selectedUserId = null;
let selectedSessionId = null;

function renderUsersTab() {
  const users = DATA.users;
  if (!users.length) return '<div class="empty">没有注册用户</div>';

  if (!selectedUserId) selectedUserId = users[0].id;

  const userListHtml = users.map(u => {
    const sCount = (sessionsByUser.get(u.id) || []).length;
    return \`
      <div class="list-item \${u.id === selectedUserId ? 'active' : ''}" data-user-id="\${u.id}">
        <div class="head">
          <span class="name">\${escape(u.phone)}</span>
          <span class="badge">\${sCount} sessions</span>
        </div>
        <div class="sub">
          注册 \${fmtDate(u.createdAt)} · 上次 \${fmtRel(u.lastSeenAt)} · \${u.totalChatTurns} 轮
        </div>
      </div>\`;
  }).join("");

  return \`
    <div class="panel-content">
      <div class="layout">
        <div class="list-pane">
          <div class="list-search">
            <input type="text" id="user-search" placeholder="搜索手机号尾号 / 显示名…">
          </div>
          <div class="list-items" id="user-list">\${userListHtml}</div>
        </div>
        <div class="detail-pane" id="user-detail">\${renderUserDetail(selectedUserId)}</div>
      </div>
    </div>\`;
}

function renderUserDetail(userId) {
  const u = userById.get(userId);
  if (!u) return '<div class="empty">未选择用户</div>';
  const sessions = sessionsByUser.get(userId) || [];
  const userFacts = DATA.facts.filter(f => f.user_id === userId && !f.archived);
  const userGoals = DATA.goals.filter(g => g.user_id === userId);

  let html = \`
    <h2 style="margin:0 0 8px">\${escape(u.phone)}</h2>
    <div style="color:var(--soft);font-size:12px;margin-bottom:12px">
      用户 #\${u.id} · 注册 \${fmtTime(u.createdAt)} · 上次活跃 \${fmtTime(u.lastSeenAt)} · 总轮数 \${u.totalChatTurns}
    </div>\`;

  if (userGoals.length) {
    html += '<h3 style="margin:16px 0 8px;font-size:14px">⭐ 北极星目标</h3>';
    html += userGoals.map(g => \`
      <div style="padding:10px;background:var(--panel-soft);border-radius:8px;margin-bottom:6px;border:1px solid var(--border);">
        \${g.is_current ? '<span class="pill ok">当前</span> ' : ''}
        \${escape(g.north_star)}
        <div style="color:var(--soft);font-size:11px;margin-top:4px">\${fmtTime(g.created_at)}</div>
      </div>\`).join("");
  }

  if (userFacts.length) {
    html += '<h3 style="margin:16px 0 8px;font-size:14px">🔍 抽取的关键事实</h3>';
    html += userFacts.slice(0, 30).map(f => \`
      <div style="padding:8px 12px;background:var(--panel-soft);border-radius:8px;margin-bottom:4px;border:1px solid var(--border);font-size:13px;">
        <span class="kind-tag kind-\${f.kind}">\${f.kind}</span>
        \${escape(f.text)}
        <span style="color:var(--soft);font-size:11px;margin-left:8px">\${fmtDate(f.created_at)}</span>
      </div>\`).join("");
  }

  html += \`<h3 style="margin:16px 0 8px;font-size:14px">💬 会话（\${sessions.length}）</h3>\`;
  if (!sessions.length) {
    html += '<div class="empty">该用户暂无会话</div>';
  } else {
    html += sessions.map(s => renderSessionCard(s)).join("");
  }
  return html;
}

function renderSessionCard(s) {
  const msgs = messagesBySession.get(s.id) || [];
  const isOpen = s.id === selectedSessionId;
  const fallbackInSess = msgs.filter(m => m.role === "assistant" && (m.degraded || isFallbackContent(m.content))).length;

  return \`
    <div class="session-card \${isOpen ? 'open' : ''}" data-session-id="\${s.id}">
      <div class="session-head">
        <div class="left">
          <div class="title">Session #\${s.id} · \${s.turnCount} 轮 · \${msgs.length} 消息</div>
          <div class="meta">
            \${fmtTime(s.startedAt)} → \${fmtTime(s.lastActiveAt)}
            \${s.cardId ? ' · card: ' + escape(s.cardId) : ''}
            \${s.anonSessionId ? ' · anon: ' + escape(s.anonSessionId) : ''}
            \${fallbackInSess > 0 ? ' · <span class="pill warn">' + fallbackInSess + ' fallback</span>' : ''}
          </div>
        </div>
        <div class="right">\${isOpen ? '▼ 收起' : '▶ 展开'}</div>
      </div>
      <div class="session-body">
        \${msgs.length ? msgs.map(renderMessage).join("") : '<div class="empty">该 session 没有消息（或被截断）</div>'}
      </div>
    </div>\`;
}

function renderMessage(m) {
  const isFallback = m.role === "assistant" && (m.degraded || isFallbackContent(m.content));
  const cls = "msg " + m.role + (isFallback ? " fallback" : "");
  const roleLabel = m.role === "user" ? "用户" : (isFallback ? "AI（降级）" : "AI");
  return \`
    <div class="\${cls}">
      <span class="role-badge">\${roleLabel}</span>
      <div>\${escape(m.content)}</div>
      <div class="msg-meta">
        <span>\${fmtTime(m.createdAt)}</span>
        <span>turn \${m.turnIndex}</span>
        \${m.provider ? '<span>· ' + escape(m.provider) + '</span>' : ''}
        \${m.tokenCount ? '<span>· ' + m.tokenCount + ' tok</span>' : ''}
      </div>
    </div>\`;
}

function renderAnonTab() {
  if (!sessionsByAnon.length) return '<div class="empty">没有匿名会话</div>';
  if (!selectedSessionId || !sessionsByAnon.find(s => s.id === selectedSessionId)) {
    selectedSessionId = sessionsByAnon[0].id;
  }
  const listHtml = sessionsByAnon.map(s => {
    const msgs = messagesBySession.get(s.id) || [];
    return \`
      <div class="list-item \${s.id === selectedSessionId ? 'active' : ''}" data-session-pick="\${s.id}">
        <div class="head">
          <span class="name">Session #\${s.id}</span>
          <span class="badge">\${msgs.length} msgs</span>
        </div>
        <div class="sub">
          \${escape(s.anonSessionId || "")} · \${fmtRel(s.lastActiveAt)}
        </div>
      </div>\`;
  }).join("");

  const sel = sessionsByAnon.find(s => s.id === selectedSessionId);
  const msgs = sel ? (messagesBySession.get(sel.id) || []) : [];

  return \`
    <div class="panel-content">
      <div class="layout">
        <div class="list-pane">
          <div class="list-search">
            <input type="text" id="anon-search" placeholder="按 session id 或 anon id…">
          </div>
          <div class="list-items" id="anon-list">\${listHtml}</div>
        </div>
        <div class="detail-pane">
          \${sel ? \`<h2 style="margin:0 0 8px">Session #\${sel.id}</h2>
            <div style="color:var(--soft);font-size:12px;margin-bottom:12px">
              \${fmtTime(sel.startedAt)} → \${fmtTime(sel.lastActiveAt)} · \${sel.turnCount} 轮
              \${sel.anonSessionId ? ' · anon ' + escape(sel.anonSessionId) : ''}
              \${sel.cardId ? ' · card ' + escape(sel.cardId) : ''}
            </div>
            \${msgs.length ? msgs.map(renderMessage).join("") : '<div class="empty">无消息</div>'}\` :
            '<div class="empty">未选择</div>'}
        </div>
      </div>
    </div>\`;
}

function renderRecentTab() {
  const recent = DATA.messages.slice(0, 200);
  return \`
    <div class="panel-content">
      <div class="list-search" style="margin-bottom:12px;background:var(--panel);border:1px solid var(--border);border-radius:10px">
        <input type="text" id="recent-search" placeholder="搜索消息内容…" style="width:100%;padding:10px;background:transparent;color:var(--text);border:none;font-size:14px;outline:none">
      </div>
      <div id="recent-results">
        \${recent.map(m => {
          const sess = DATA.sessions.find(s => s.id === m.sessionId);
          const u = sess && sess.userId ? userById.get(sess.userId) : null;
          const owner = u ? u.phone : (sess && sess.anonSessionId ? sess.anonSessionId : "anon");
          return \`<div style="margin-bottom:10px;padding:10px;background:var(--panel);border:1px solid var(--border);border-radius:10px;font-size:13px">
            <div style="color:var(--soft);font-size:11px;margin-bottom:6px">
              \${fmtTime(m.createdAt)} · \${escape(owner)} · session #\${m.sessionId} · \${m.role}
              \${m.degraded ? ' · <span class="pill warn">degraded</span>' : ''}
            </div>
            <div style="white-space:pre-wrap;word-break:break-word">\${escape(m.content.slice(0, 800))}\${m.content.length > 800 ? '…' : ''}</div>
          </div>\`;
        }).join("")}
      </div>
    </div>\`;
}

function renderFallbackTab() {
  const fallbacks = DATA.messages.filter(m =>
    m.role === "assistant" && (m.degraded || isFallbackContent(m.content))
  );
  if (!fallbacks.length) return '<div class="panel-content"><div class="empty">没有 fallback 回复，DeepSeek 全程在线</div></div>';

  return \`
    <div class="panel-content">
      <p style="color:var(--soft);font-size:13px">
        共 <strong>\${fallbacks.length}</strong> 条 fallback / 降级回复。这意味着用户在这些时刻问问题，AI 没真正回答，只返回了模板。
      </p>
      \${fallbacks.slice(0, 100).map(m => {
        const sess = DATA.sessions.find(s => s.id === m.sessionId);
        const userMsgs = (messagesBySession.get(m.sessionId) || []).filter(x => x.role === "user");
        const triggerMsg = userMsgs.find(x => x.turnIndex === m.turnIndex - 1) || userMsgs[userMsgs.length - 1];
        return \`<div style="margin-bottom:14px;padding:12px;background:var(--panel);border:1px solid var(--border);border-radius:10px">
          <div style="color:var(--soft);font-size:11px;margin-bottom:8px">
            \${fmtTime(m.createdAt)} · session #\${m.sessionId}
            \${sess && sess.userId ? ' · ' + escape((userById.get(sess.userId)||{}).phone || "?") : ' · 匿名'}
          </div>
          \${triggerMsg ? \`<div style="font-size:12px;color:var(--accent);margin-bottom:6px">用户问：\${escape(triggerMsg.content.slice(0, 200))}</div>\` : ''}
          <div style="white-space:pre-wrap;font-size:13px;background:var(--fallback-bubble);padding:8px;border-radius:6px">
            \${escape(m.content)}
          </div>
        </div>\`;
      }).join("")}
    </div>\`;
}

function renderFactsTab() {
  if (!DATA.facts.length) return '<div class="panel-content"><div class="empty">还没抽取到任何事实</div></div>';
  return \`
    <div class="panel-content">
      <table>
        <thead>
          <tr>
            <th>用户</th>
            <th>类型</th>
            <th>内容</th>
            <th>状态</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody>
          \${DATA.facts.map(f => {
            const u = userById.get(f.user_id);
            return \`<tr>
              <td>\${u ? escape(u.phone) : '#' + f.user_id}</td>
              <td><span class="kind-tag kind-\${f.kind}">\${f.kind}</span></td>
              <td>\${escape(f.text)}</td>
              <td>
                \${f.pinned ? '<span class="pill ok">pinned</span> ' : ''}
                \${f.archived ? '<span class="pill warn">archived</span>' : ''}
              </td>
              <td>\${fmtDate(f.created_at)}</td>
            </tr>\`;
          }).join("")}
        </tbody>
      </table>
    </div>\`;
}

function renderGoalsTab() {
  if (!DATA.goals.length) return '<div class="panel-content"><div class="empty">还没人设北极星</div></div>';
  return \`
    <div class="panel-content">
      <table>
        <thead>
          <tr><th>用户</th><th>北极星</th><th>状态</th><th>设定时间</th></tr>
        </thead>
        <tbody>
          \${DATA.goals.map(g => {
            const u = userById.get(g.user_id);
            return \`<tr>
              <td>\${u ? escape(u.phone) : '#' + g.user_id}</td>
              <td>\${escape(g.north_star)}</td>
              <td>\${g.is_current ? '<span class="pill ok">当前</span>' : '<span class="pill warn">已归档</span>'}</td>
              <td>\${fmtTime(g.created_at)}</td>
            </tr>\`;
          }).join("")}
        </tbody>
      </table>
    </div>\`;
}

function renderLongestTab() {
  // 按 session 算总字符数（user + assistant），找成本大户
  const sessionStats = DATA.sessions.map(s => {
    const msgs = messagesBySession.get(s.id) || [];
    const totalChars = msgs.reduce((a, m) => a + (m.content || "").length, 0);
    const tokenSum = msgs.reduce((a, m) => a + (m.tokenCount || 0), 0);
    return { ...s, msgCount: msgs.length, totalChars, tokenSum };
  }).sort((a, b) => b.totalChars - a.totalChars).slice(0, 50);

  return \`
    <div class="panel-content">
      <p style="color:var(--soft);font-size:13px">
        按对话总字符数（user + assistant）排序，前 50 个 session。如果某个 session 字符数极高、消息数也多 → 它就是 4/24 烧 ¥55 的大户之一。
      </p>
      <table>
        <thead>
          <tr><th>Session</th><th>归属</th><th>消息数</th><th>总字符</th><th>token 和</th><th>起止</th></tr>
        </thead>
        <tbody>
          \${sessionStats.map(s => {
            const u = s.userId ? userById.get(s.userId) : null;
            return \`<tr>
              <td>#\${s.id}</td>
              <td>\${u ? escape(u.phone) : (s.anonSessionId ? escape(s.anonSessionId) : '—')}</td>
              <td>\${s.msgCount}</td>
              <td>\${fmtCount(s.totalChars)}</td>
              <td>\${fmtCount(s.tokenSum)}</td>
              <td>\${fmtDate(s.startedAt)} → \${fmtDate(s.lastActiveAt)}</td>
            </tr>\`;
          }).join("")}
        </tbody>
      </table>
    </div>\`;
}

function bindInteractions() {
  // 用户列表点击
  document.querySelectorAll("[data-user-id]").forEach(el => {
    el.addEventListener("click", () => {
      selectedUserId = Number(el.dataset.userId);
      selectedSessionId = null;
      render();
    });
  });
  // session 卡片展开
  document.querySelectorAll(".session-card").forEach(card => {
    const id = Number(card.dataset.sessionId);
    card.querySelector(".session-head").addEventListener("click", () => {
      selectedSessionId = (selectedSessionId === id) ? null : id;
      render();
    });
  });
  // 匿名 session 点击
  document.querySelectorAll("[data-session-pick]").forEach(el => {
    el.addEventListener("click", () => {
      selectedSessionId = Number(el.dataset.sessionPick);
      render();
    });
  });

  // 用户搜索
  const userSearch = document.getElementById("user-search");
  if (userSearch) {
    userSearch.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase().trim();
      document.querySelectorAll("#user-list .list-item").forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = (!q || text.includes(q)) ? "" : "none";
      });
    });
  }

  // 匿名搜索
  const anonSearch = document.getElementById("anon-search");
  if (anonSearch) {
    anonSearch.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase().trim();
      document.querySelectorAll("#anon-list .list-item").forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = (!q || text.includes(q)) ? "" : "none";
      });
    });
  }

  // 最近搜索
  const recentSearch = document.getElementById("recent-search");
  if (recentSearch) {
    recentSearch.addEventListener("input", (e) => {
      const q = e.target.value.toLowerCase().trim();
      const allMsgs = DATA.messages.slice(0, 1000);
      const matched = !q ? allMsgs.slice(0, 200) : allMsgs.filter(m => (m.content || "").toLowerCase().includes(q)).slice(0, 200);
      document.getElementById("recent-results").innerHTML = matched.map(m => {
        const sess = DATA.sessions.find(s => s.id === m.sessionId);
        const u = sess && sess.userId ? userById.get(sess.userId) : null;
        const owner = u ? u.phone : (sess && sess.anonSessionId ? sess.anonSessionId : "anon");
        return \`<div style="margin-bottom:10px;padding:10px;background:var(--panel);border:1px solid var(--border);border-radius:10px;font-size:13px">
          <div style="color:var(--soft);font-size:11px;margin-bottom:6px">
            \${fmtTime(m.createdAt)} · \${escape(owner)} · session #\${m.sessionId} · \${m.role}
            \${m.degraded ? ' · <span class="pill warn">degraded</span>' : ''}
          </div>
          <div style="white-space:pre-wrap;word-break:break-word">\${escape(m.content.slice(0, 800))}\${m.content.length > 800 ? '…' : ''}</div>
        </div>\`;
      }).join("") || '<div class="empty">无匹配</div>';
    });
  }
}

render();
</script>
</body>
</html>`;

fs.writeFileSync(OUT_PATH, html, "utf8");
fs.chmodSync(OUT_PATH, 0o600);

const sizeKb = (fs.statSync(OUT_PATH).size / 1024).toFixed(1);
console.log("");
console.log("============================================");
console.log("  Admin snapshot exported successfully");
console.log("============================================");
console.log("  File:    " + OUT_PATH);
console.log("  Size:    " + sizeKb + " KB");
console.log("  Perm:    0600 (root only)");
console.log("");
console.log("  Stats:");
console.log("    users        : " + totals.users);
console.log("    sessions     : " + totals.sessions + " (auth " + totals.sessionsAuth + " / anon " + totals.sessionsAnon + ")");
console.log("    messages     : " + totals.messages + " (exported " + messages.length + ")");
console.log("    facts        : " + totals.facts);
console.log("    goals        : " + totals.goals);
console.log("");
console.log("  Next steps:");
console.log("    1. In Workbench, click '文件' or '文件传输' icon");
console.log("    2. Download " + OUT_PATH + " to your local PC");
console.log("    3. Double-click the .html file to open in your browser");
console.log("    4. After reviewing, DELETE both:");
console.log("       - rm " + OUT_PATH);
console.log("       - the local copy on your PC");
console.log("============================================");
