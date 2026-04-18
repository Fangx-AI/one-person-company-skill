#!/usr/bin/env node
const http = require("http");

const BASE = "http://localhost:3000";

function request({ path, method = "GET", headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: { "Content-Type": "application/json", ...headers },
    };
    const req = http.request(BASE + path, options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
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
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
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

function joinCookies(setCookieHeaders, prevCookieJar = "") {
  const arr = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders].filter(Boolean);
  const result = {};
  for (const part of prevCookieJar.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) result[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  for (const cookie of arr) {
    const first = cookie.split(";")[0];
    const idx = first.indexOf("=");
    if (idx > 0) result[first.slice(0, idx).trim()] = first.slice(idx + 1).trim();
  }
  return Object.entries(result)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

function section(name) {
  console.log("");
  console.log("─".repeat(60));
  console.log(name);
  console.log("─".repeat(60));
}

async function main() {
  const TEST_PHONE = "13900" + Math.floor(100000 + Math.random() * 900000);
  console.log(`Using test phone: ${TEST_PHONE}`);

  section("1. /api/auth/me (anonymous)");
  const meAnon = await request({ path: "/api/auth/me" });
  assert(meAnon.status === 200, `200 OK (got ${meAnon.status})`);
  assert(meAnon.json?.authenticated === false, "authenticated=false");

  section("2. /api/auth/send-code with invalid phone");
  const badPhone = await request({
    path: "/api/auth/send-code",
    method: "POST",
    body: { phone: "not-a-phone" },
  });
  assert(badPhone.status === 400, `400 BadRequest (got ${badPhone.status})`);
  assert(badPhone.json?.error === "invalid_phone", "error=invalid_phone");

  section("3. /api/auth/send-code with valid phone");
  const sendRes = await request({
    path: "/api/auth/send-code",
    method: "POST",
    body: { phone: TEST_PHONE },
  });
  assert(sendRes.status === 200, `200 OK (got ${sendRes.status})`);
  assert(sendRes.json?.ok === true, "ok=true");
  assert(sendRes.json?.provider === "mock", "provider=mock (no aliyun configured)");
  assert(/^\d{6}$/.test(sendRes.json?.devCode || ""), "devCode is 6 digits");
  const code = sendRes.json.devCode;
  console.log(`  → got code ${code}`);

  section("4. /api/auth/send-code throttled (within 60s)");
  const throttled = await request({
    path: "/api/auth/send-code",
    method: "POST",
    body: { phone: TEST_PHONE },
  });
  assert(throttled.status === 429, `429 Throttled (got ${throttled.status})`);
  assert(throttled.json?.error === "too_soon", "error=too_soon");

  section("5. /api/auth/verify-code with wrong code");
  const wrong = await request({
    path: "/api/auth/verify-code",
    method: "POST",
    body: { phone: TEST_PHONE, code: "000000" },
  });
  assert(wrong.status === 400, `400 BadRequest (got ${wrong.status})`);
  assert(wrong.json?.error === "wrong_code", "error=wrong_code");

  section("6. /api/auth/verify-code with correct code");
  const verify = await request({
    path: "/api/auth/verify-code",
    method: "POST",
    body: { phone: TEST_PHONE, code },
  });
  assert(verify.status === 200, `200 OK (got ${verify.status})`);
  assert(verify.json?.ok === true, "ok=true");
  assert(verify.json?.user?.phone === TEST_PHONE, "user.phone matches");
  assert(typeof verify.json?.user?.id === "number", "user.id is number");
  assert(verify.json?.hasNorthStar === false, "hasNorthStar=false (new user)");

  const setCookie = verify.headers["set-cookie"];
  assert(Array.isArray(setCookie) || typeof setCookie === "string", "Set-Cookie header present");
  const cookieJar = joinCookies(setCookie);
  console.log(`  → cookie jar: ${cookieJar.slice(0, 60)}...`);

  section("7. /api/auth/me (authenticated)");
  const meAuth = await request({
    path: "/api/auth/me",
    headers: { Cookie: cookieJar },
  });
  assert(meAuth.status === 200, `200 OK (got ${meAuth.status})`);
  assert(meAuth.json?.authenticated === true, "authenticated=true");
  assert(meAuth.json?.user?.phone === TEST_PHONE, "phone matches");

  section("8. /api/auth/verify-code with replayed code (should fail)");
  const replay = await request({
    path: "/api/auth/verify-code",
    method: "POST",
    body: { phone: TEST_PHONE, code },
  });
  assert(replay.status === 400, `400 BadRequest (got ${replay.status})`);
  assert(replay.json?.error === "no_active_code", "code consumed, no_active_code");

  section("9. /api/auth/logout");
  const logout = await request({
    path: "/api/auth/logout",
    method: "POST",
    headers: { Cookie: cookieJar },
  });
  assert(logout.status === 200, `200 OK (got ${logout.status})`);
  const clearCookie = logout.headers["set-cookie"];
  const clearedJar = Array.isArray(clearCookie) ? clearCookie.join("; ") : String(clearCookie || "");
  assert(/Max-Age=0/.test(clearedJar), "logout sets Max-Age=0");

  section("10. /api/auth/me with cleared cookie");
  const meAfterLogout = await request({
    path: "/api/auth/me",
    headers: { Cookie: "" },
  });
  assert(meAfterLogout.json?.authenticated === false, "after clear, authenticated=false");

  console.log("");
  console.log("═".repeat(60));
  console.log("ALL AUTH SMOKE TESTS PASSED ✓");
  console.log("═".repeat(60));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
