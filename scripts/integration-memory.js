// 端到端集成测试：用户注册 → 写 facts → 拿 dashboard → pin/archive
// 直接走 db + session，跳过 SMS。
//
// !!! 重要：本脚本写到独立的 data/test.db，不会污染生产 app.db。
//          服务端必须用同一个 SQLITE_DB_PATH 启动才能看到这些数据。
//
// 运行：先在另一个终端用相同的 env 启动服务器：
//   $env:PORT="3099"
//   $env:USER_SESSION_SECRET="test_secret_at_least_32_chars_long_xxx"
//   $env:SQLITE_DB_PATH="$PWD/data/test.db"
//   node server.js
// 然后跑：
//   $env:PORT="3099"
//   $env:USER_SESSION_SECRET="test_secret_at_least_32_chars_long_xxx"
//   $env:SQLITE_DB_PATH="$PWD/data/test.db"
//   node scripts/integration-memory.js

const path = require("path");
const fs = require("fs");

process.env.PORT = process.env.PORT || "3099";
// 强制隔离 DB：永远不允许把测试数据写到生产 app.db。
const TEST_DB_PATH = path.join(__dirname, "..", "data", "test.db");
process.env.SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || TEST_DB_PATH;
if (path.basename(process.env.SQLITE_DB_PATH) === "app.db") {
  console.error(
    "REFUSED: integration test would write to app.db. Set SQLITE_DB_PATH to a non-prod file."
  );
  process.exit(2);
}

if (!process.env.USER_SESSION_SECRET || process.env.USER_SESSION_SECRET.length < 32) {
  console.error("USER_SESSION_SECRET (>=32 chars) must be set and identical to the server's");
  process.exit(2);
}

// 每次测试开始前清空 test.db，保证可重复
if (fs.existsSync(process.env.SQLITE_DB_PATH)) {
  fs.unlinkSync(process.env.SQLITE_DB_PATH);
}

const session = require(path.join(__dirname, "..", "auth", "session"));
const dbUsers = require(path.join(__dirname, "..", "db", "users"));
const dbFacts = require(path.join(__dirname, "..", "db", "facts"));

const BASE = `http://127.0.0.1:${process.env.PORT}`;
let passed = 0;
let failed = 0;

function ok(name) {
  console.log(`  PASS  ${name}`);
  passed += 1;
}
function bad(name, err) {
  console.error(`  FAIL  ${name}`);
  console.error(`        ${err?.message || err}`);
  failed += 1;
}

async function api(path, opts = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };
  if (opts.token) headers.Cookie = `${session.USER_COOKIE}=${opts.token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json: json || {} };
}

async function main() {
  console.log("\n[memory pipeline integration]\n");

  // 1. 创建测试用户（手机号唯一）
  const phone = `139${Date.now().toString().slice(-8)}`;
  let user;
  try {
    user = dbUsers.findOrCreateByPhone(phone);
    if (!user || !user.id) throw new Error("user not created");
    ok(`create test user (id=${user.id}, phone=${phone})`);
  } catch (err) {
    bad("create test user", err);
    process.exit(1);
  }

  // 2. mint session token
  const token = session.createUserToken(user.id);
  if (!token) {
    bad("mint session token", "empty token");
    process.exit(1);
  }
  ok("mint session token");

  // 3. 写北极星
  try {
    const r = await api("/api/me/north-star", {
      method: "POST",
      token,
      body: { northStar: "做出真正能帮个人创业者把事想清楚的工具" },
    });
    if (r.status !== 200 || !r.json.ok) throw new Error(JSON.stringify(r));
    ok("set north star via API");
  } catch (err) {
    bad("set north star via API", err);
  }

  // 4. 直接插入几条 facts（模拟 LLM 抽取结果）
  let fact1, fact2, fact3;
  try {
    fact1 = dbFacts.createFact({
      userId: user.id,
      kind: "intend",
      text: "我打算下周做出第一版 demo 给 5 个朋友看",
    });
    fact2 = dbFacts.createFact({
      userId: user.id,
      kind: "blocker",
      text: "我卡在不知道怎么定价",
    });
    fact3 = dbFacts.createFact({
      userId: user.id,
      kind: "deadline",
      text: "我要在 6 月之前拿到第一个付费用户",
    });
    if (!fact1?.id || !fact2?.id || !fact3?.id) throw new Error("missing id");
    ok(`insert 3 facts (ids ${fact1.id}/${fact2.id}/${fact3.id})`);
  } catch (err) {
    bad("insert 3 facts", err);
  }

  // 5. dashboard 应该返回这一切
  try {
    const r = await api("/api/me/dashboard", { token });
    if (r.status !== 200) throw new Error(`status ${r.status}`);
    if (!r.json.northStar?.text?.includes("个人创业者")) throw new Error("no north star in payload");
    if (!Array.isArray(r.json.facts) || r.json.facts.length < 3) {
      throw new Error(`expected >=3 facts, got ${r.json.facts?.length}`);
    }
    const kinds = r.json.facts.map((f) => f.kind);
    if (!kinds.includes("intend") || !kinds.includes("blocker") || !kinds.includes("deadline")) {
      throw new Error(`missing kinds: ${kinds}`);
    }
    ok("dashboard returns north star + 3 facts");
  } catch (err) {
    bad("dashboard returns", err);
  }

  // 6. pin a fact
  try {
    const r = await api(`/api/me/facts/${fact1.id}/pin`, {
      method: "POST",
      token,
      body: { pinned: true },
    });
    if (r.status !== 200 || r.json.pinned !== true) throw new Error(JSON.stringify(r));
    ok("pin fact via API");
  } catch (err) {
    bad("pin fact via API", err);
  }

  // 7. archive a fact
  try {
    const r = await api(`/api/me/facts/${fact2.id}/archive`, {
      method: "POST",
      token,
      body: { archived: true },
    });
    if (r.status !== 200 || r.json.archived !== true) throw new Error(JSON.stringify(r));
    ok("archive fact via API");
  } catch (err) {
    bad("archive fact via API", err);
  }

  // 8. dashboard 后应该不再返回 archived 那条
  try {
    const r = await api("/api/me/dashboard", { token });
    const stillThere = r.json.facts?.some((f) => f.id === fact2.id);
    if (stillThere) throw new Error("archived fact still in dashboard");
    const pinnedFirst = r.json.facts?.[0]?.id === fact1.id && r.json.facts[0].pinned;
    if (!pinnedFirst) throw new Error(`pinned fact not first: ${JSON.stringify(r.json.facts?.[0])}`);
    ok("dashboard hides archived, surfaces pinned first");
  } catch (err) {
    bad("dashboard reflects pin/archive", err);
  }

  // 9. cross-user isolation: 创建另一个用户，确保看不到 user1 的 facts
  const phone2 = `138${Date.now().toString().slice(-8)}`;
  try {
    const user2 = dbUsers.findOrCreateByPhone(phone2);
    const token2 = session.createUserToken(user2.id);
    const r = await api("/api/me/dashboard", { token: token2 });
    if (r.json.facts?.length > 0) throw new Error(`user2 sees facts: ${r.json.facts.length}`);
    ok("cross-user isolation: user2 has no facts");
  } catch (err) {
    bad("cross-user isolation", err);
  }

  // 10. unauthorized request rejected
  try {
    const r = await api("/api/me/dashboard");
    if (r.status !== 401) throw new Error(`expected 401, got ${r.status}`);
    ok("unauthorized request rejected (401)");
  } catch (err) {
    bad("unauthorized rejection", err);
  }

  // cleanup: 软删 facts (archived already), users 留在 db 不影响
  console.log(`\n${passed} pass, ${failed} fail\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("UNCAUGHT:", err);
  process.exit(2);
});
