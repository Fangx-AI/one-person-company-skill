#!/usr/bin/env node
const http = require("http");
const { getDb } = require("../db/database");

const BASE = "http://localhost:3000";

function request({ path, method = "GET", headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: BASE,
        Referer: BASE + "/",
        ...headers,
      },
    };
    const req = http.request(BASE + path, options, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data,
          json: (() => { try { return JSON.parse(data); } catch { return null; } })(),
        })
      );
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function assert(cond, msg) {
  if (!cond) {
    console.error("✗ FAIL:", msg);
    process.exit(1);
  }
  console.log("  ✓", msg);
}

function joinSetCookies(arr) {
  if (!arr) return "";
  const list = Array.isArray(arr) ? arr : [arr];
  const jar = {};
  for (const c of list) {
    const first = String(c).split(";")[0];
    const idx = first.indexOf("=");
    if (idx > 0) jar[first.slice(0, idx).trim()] = first.slice(idx + 1).trim();
  }
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

function section(name) {
  console.log("");
  console.log("─".repeat(60));
  console.log(name);
  console.log("─".repeat(60));
}

async function main() {
  const db = getDb();

  section("1. Bootstrap: GET /config.js to obtain anon session cookie + chat token");
  const configRes = await request({ path: "/config.js" });
  assert(configRes.status === 200, `200 OK (got ${configRes.status})`);
  const cookieJar = joinSetCookies(configRes.headers["set-cookie"]);
  assert(/book_of_elon_sid=/.test(cookieJar), "anon session cookie set");

  const tokenMatch = configRes.body.match(/"chatSessionToken"\s*:\s*"([^"]+)"/);
  assert(tokenMatch, "chatSessionToken in runtime config");
  const chatToken = tokenMatch[1];

  const sidMatch = cookieJar.match(/book_of_elon_sid=([^;]+)/);
  const anonSessionId = decodeURIComponent(sidMatch[1]);
  console.log(`  → anon session id: ${anonSessionId.slice(0, 16)}...`);

  section("2. Get message count BEFORE chat");
  const beforeCount = db.prepare("SELECT COUNT(*) AS c FROM messages").get().c;
  const beforeSessions = db.prepare("SELECT COUNT(*) AS c FROM chat_sessions").get().c;
  console.log(`  → before: ${beforeSessions} sessions, ${beforeCount} messages`);

  section("3. POST /api/chat with a real question");
  const chatRes = await request({
    path: "/api/chat",
    method: "POST",
    headers: {
      Cookie: cookieJar,
      "x-book-of-elon-token": chatToken,
    },
    body: {
      model: "deepseek-chat",
      systemPrompt: "你是测试助手，简短回复。",
      promptVersion: "v2",
      messages: [
        { role: "user", content: "测试持久化：请回复'收到'两个字" },
      ],
      context: {
        activeCard: { id: "test-card-persist", title: "测试卡片", chapter: "测试章节" },
        bookSnippets: [],
        productRules: [],
      },
    },
  });
  assert(chatRes.status === 200, `200 OK (got ${chatRes.status}, body: ${chatRes.body.slice(0, 100)})`);
  assert(typeof chatRes.json?.reply === "string" && chatRes.json.reply.length > 0, "got non-empty reply");
  console.log(`  → provider: ${chatRes.json.provider}`);
  console.log(`  → reply: "${chatRes.json.reply.slice(0, 80)}..."`);

  await new Promise((r) => setTimeout(r, 200));

  section("4. Verify message count AFTER chat (+2 messages, +1 session)");
  const afterCount = db.prepare("SELECT COUNT(*) AS c FROM messages").get().c;
  const afterSessions = db.prepare("SELECT COUNT(*) AS c FROM chat_sessions").get().c;
  console.log(`  → after: ${afterSessions} sessions, ${afterCount} messages`);
  assert(afterCount === beforeCount + 2, `messages +2 (got +${afterCount - beforeCount})`);
  assert(afterSessions === beforeSessions + 1, `sessions +1 (got +${afterSessions - beforeSessions})`);

  section("5. Verify session is anon-keyed");
  const sessionRow = db
    .prepare("SELECT * FROM chat_sessions WHERE anon_session_id = ? ORDER BY id DESC LIMIT 1")
    .get(anonSessionId);
  assert(sessionRow, "found session by anon_session_id");
  assert(sessionRow.user_id === null, "user_id is null (anon)");
  assert(sessionRow.card_id === "test-card-persist", "card_id matches");
  assert(sessionRow.turn_count === 2, `turn_count=2 (got ${sessionRow.turn_count})`);

  section("6. Verify message contents in correct order");
  const messages = db
    .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY turn_index ASC")
    .all(sessionRow.id);
  assert(messages.length === 2, `2 messages (got ${messages.length})`);
  assert(messages[0].role === "user", "msg 0 is user");
  assert(messages[0].content.includes("测试持久化"), "msg 0 content matches");
  assert(messages[1].role === "assistant", "msg 1 is assistant");
  assert(messages[1].content.length > 0, "msg 1 content non-empty");
  assert(typeof messages[1].provider === "string" && messages[1].provider.length > 0, "msg 1 provider set");

  section("7. Send second chat → should REUSE same session (within 6h window)");
  const chatRes2 = await request({
    path: "/api/chat",
    method: "POST",
    headers: { Cookie: cookieJar, "x-book-of-elon-token": chatToken },
    body: {
      model: "deepseek-chat",
      systemPrompt: "你是测试助手。",
      promptVersion: "v2",
      messages: [
        { role: "user", content: "测试持久化：请回复'收到'两个字" },
        { role: "assistant", content: chatRes.json.reply },
        { role: "user", content: "再发一条：回复'好的'" },
      ],
      context: { activeCard: { id: "test-card-persist", title: "测试卡片" }, bookSnippets: [], productRules: [] },
    },
  });
  assert(chatRes2.status === 200, `chat 2 OK`);

  await new Promise((r) => setTimeout(r, 200));

  const afterSessions2 = db.prepare("SELECT COUNT(*) AS c FROM chat_sessions").get().c;
  const sessionAfter2 = db
    .prepare("SELECT * FROM chat_sessions WHERE id = ?")
    .get(sessionRow.id);
  assert(afterSessions2 === afterSessions, `no new session created (still ${afterSessions})`);
  assert(sessionAfter2.turn_count === 4, `turn_count=4 (got ${sessionAfter2.turn_count})`);

  section("8. New session for DIFFERENT card → should create NEW session");
  const chatRes3 = await request({
    path: "/api/chat",
    method: "POST",
    headers: { Cookie: cookieJar, "x-book-of-elon-token": chatToken },
    body: {
      model: "deepseek-chat",
      systemPrompt: "你是测试助手。",
      promptVersion: "v2",
      messages: [{ role: "user", content: "新卡片测试：回复'收到2'" }],
      context: { activeCard: { id: "test-card-different", title: "另一张卡片" }, bookSnippets: [], productRules: [] },
    },
  });
  assert(chatRes3.status === 200, `chat 3 OK`);

  await new Promise((r) => setTimeout(r, 200));

  const afterSessions3 = db.prepare("SELECT COUNT(*) AS c FROM chat_sessions").get().c;
  assert(afterSessions3 === afterSessions2 + 1, `+1 new session (different card)`);

  section("9. Cleanup test data");
  const deleted = db.prepare("DELETE FROM chat_sessions WHERE card_id IN (?, ?)").run(
    "test-card-persist",
    "test-card-different"
  );
  console.log(`  → deleted ${deleted.changes} test sessions (cascade cleans messages)`);

  console.log("");
  console.log("═".repeat(60));
  console.log("ALL PERSISTENCE SMOKE TESTS PASSED ✓");
  console.log("═".repeat(60));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
