#!/usr/bin/env node
const http = require("http");
const BASE = "http://localhost:3000";

function request({ path, method = "GET", headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      BASE + path,
      { method, headers: { "Content-Type": "application/json", ...headers } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            json: (() => { try { return JSON.parse(data); } catch { return null; } })(),
          })
        );
      }
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function joinSetCookies(arr) {
  if (!arr) return "";
  const list = Array.isArray(arr) ? arr : [arr];
  const jar = {};
  for (const c of list) {
    const f = String(c).split(";")[0];
    const i = f.indexOf("=");
    if (i > 0) jar[f.slice(0, i).trim()] = f.slice(i + 1).trim();
  }
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");
}

function assert(cond, msg) {
  if (!cond) {
    console.error("✗ FAIL:", msg);
    process.exit(1);
  }
  console.log("  ✓", msg);
}

function section(s) {
  console.log("\n" + "─".repeat(60) + "\n" + s + "\n" + "─".repeat(60));
}

async function main() {
  const TEST_PHONE = "13900" + Math.floor(100000 + Math.random() * 900000);
  console.log("Test phone:", TEST_PHONE);

  section("1. Send code");
  const sendRes = await request({
    path: "/api/auth/send-code",
    method: "POST",
    body: { phone: TEST_PHONE },
  });
  assert(sendRes.status === 200, "200 OK");
  assert(sendRes.json?.devCode, "devCode returned (mock provider)");
  const code = sendRes.json.devCode;

  section("2. Verify code → get session cookie");
  const verifyRes = await request({
    path: "/api/auth/verify-code",
    method: "POST",
    body: { phone: TEST_PHONE, code },
  });
  assert(verifyRes.status === 200, "200 OK");
  assert(verifyRes.json?.hasNorthStar === false, "no north star yet");
  const cookieJar = joinSetCookies(verifyRes.headers["set-cookie"]);
  console.log(`  → cookie: ${cookieJar.slice(0, 50)}...`);

  section("3. Set north star");
  const setRes = await request({
    path: "/api/me/north-star",
    method: "POST",
    headers: { Cookie: cookieJar },
    body: { northStar: "用 AI 把心理咨询的成本降到 1/100" },
  });
  assert(setRes.status === 200, "200 OK");
  assert(setRes.json?.ok === true, "ok=true");
  assert(setRes.json?.goal?.northStar === "用 AI 把心理咨询的成本降到 1/100", "northStar saved");
  assert(typeof setRes.json?.goal?.id === "number", "goal.id is number");
  console.log(`  → goal id: ${setRes.json.goal.id}`);

  section("4. /api/auth/me now reflects north star");
  const meRes = await request({
    path: "/api/auth/me",
    headers: { Cookie: cookieJar },
  });
  assert(meRes.status === 200, "200 OK");
  assert(meRes.json?.authenticated === true, "authenticated");
  assert(meRes.json?.hasNorthStar === true, "hasNorthStar=true");
  assert(meRes.json?.northStar === "用 AI 把心理咨询的成本降到 1/100", "northStar matches");

  section("5. Update north star (replaces previous)");
  const updateRes = await request({
    path: "/api/me/north-star",
    method: "POST",
    headers: { Cookie: cookieJar },
    body: { northStar: "用 5 年时间，把火箭发射成本压到现在的 1/100" },
  });
  assert(updateRes.status === 200, "update 200");
  assert(updateRes.json?.goal?.id !== setRes.json.goal.id, "new goal record created");

  section("6. /api/me/dashboard returns full state");
  const dashRes = await request({
    path: "/api/me/dashboard",
    headers: { Cookie: cookieJar },
  });
  assert(dashRes.status === 200, "200 OK");
  assert(dashRes.json?.user?.phone === TEST_PHONE, "user.phone matches");
  assert(dashRes.json?.northStar?.text === "用 5 年时间，把火箭发射成本压到现在的 1/100", "current north star");
  assert(Array.isArray(dashRes.json?.goalHistory), "goalHistory array");
  assert(dashRes.json.goalHistory.length === 2, "2 goals in history");
  assert(Array.isArray(dashRes.json?.facts), "facts array");
  assert(Array.isArray(dashRes.json?.sessions), "sessions array");

  section("7. Validation: too short");
  const tooShortRes = await request({
    path: "/api/me/north-star",
    method: "POST",
    headers: { Cookie: cookieJar },
    body: { northStar: "嗯" },
  });
  assert(tooShortRes.status === 400, "400 BadRequest");
  assert(tooShortRes.json?.error === "too_short", "error=too_short");

  section("8. Validation: too long");
  const tooLongRes = await request({
    path: "/api/me/north-star",
    method: "POST",
    headers: { Cookie: cookieJar },
    body: { northStar: "x".repeat(201) },
  });
  assert(tooLongRes.status === 400, "400 BadRequest");
  assert(tooLongRes.json?.error === "too_long", "error=too_long");

  section("9. No auth → 401");
  const noAuthRes = await request({
    path: "/api/me/north-star",
    method: "POST",
    body: { northStar: "test" },
  });
  assert(noAuthRes.status === 401, "401 Unauthorized");
  assert(noAuthRes.json?.error === "auth_required", "error=auth_required");

  console.log("\n" + "═".repeat(60));
  console.log("ALL NORTH-STAR SMOKE TESTS PASSED ✓");
  console.log("═".repeat(60));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
