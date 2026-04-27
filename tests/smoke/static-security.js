#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// scripts/smoke-static-security.js
// ────────────────────────────────────────────────────────────────
// 验证 serveStaticFile 的安全收紧不会误伤合法静态资源，同时
// 确实把敏感路径（/data/*.db、/.env、/server.js、源码目录等）
// 全部挡在 404。
//
// 必须在 server 已经跑起来时执行：
//   $env:NODE_ENV="development"; node server.js   (另一终端)
//   node scripts/smoke-static-security.js
// ════════════════════════════════════════════════════════════════

const http = require("http");

const BASE = process.env.SMOKE_BASE || "http://localhost:3000";

function request(pathStr) {
  return new Promise((resolve, reject) => {
    const req = http.request(BASE + pathStr, { method: "GET" }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          bodyLen: data.length,
          body: data,
        })
      );
    });
    req.on("error", reject);
    req.end();
  });
}

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("  ✗ FAIL:", msg);
    failures += 1;
  } else {
    console.log("  ✓", msg);
  }
}

(async () => {
  console.log(`\n>> static-security smoke against ${BASE}\n`);

  // ────────────────────────────────────────────────────────────
  // ALLOW: 站点正常依赖的资源必须仍可访问
  // ────────────────────────────────────────────────────────────
  console.log("【allowlist：合法资源应 200】");
  const allow = [
    "/",
    "/index.html",
    "/styles.css",
    "/styles.css?v=20260418-modal4",
    "/app.js",
    "/auth-ui.js",
    "/card-data.js",
    "/knowledge-base.js",
    // R-23 修复：之前白名单漏了 book-source.js，导致 361KB 知识源 404 静默失效
    "/book-source.js",
    "/model-client.js",
    "/reply-engine.js",
  ];
  for (const p of allow) {
    const r = await request(p);
    assert(r.status === 200, `${p} → 200 (got ${r.status})`);
  }

  // /config.js 是动态路由，不走 serveStaticFile，但也应可达
  {
    const r = await request("/config.js");
    assert(r.status === 200, `/config.js (动态路由) → 200 (got ${r.status})`);
  }

  // ────────────────────────────────────────────────────────────
  // DENY: 敏感文件 / 服务端目录 / dotfile / 黑扩展名 全部 404
  // ────────────────────────────────────────────────────────────
  console.log("\n【denylist：敏感路径应 404】");
  const deny = [
    // 之前最严重的洞 —— 用户数据库
    "/data/app.db",
    "/data/test-e2e.db",
    "/data/business-metrics.json",
    "/data/backups/anything.gz",

    // dotfile 全拦
    "/.env",
    "/.env.example",
    "/.env.production.example",
    "/.gitignore",
    "/.dockerignore",
    "/.git/config",
    "/.gstack/security-reports/anything",

    // 服务端代码目录
    "/db/sessions.js",
    "/db/users.js",
    "/auth/session.js",
    "/auth/sms-sender.js",
    "/routes/auth.js",
    "/routes/me.js",
    "/services/fact-extractor.js",
    "/scripts/ops/backup-db.js",
    "/scripts/ops/migrate.js",
    "/scripts/tools/cleanup-claimed-sessions.js",
    "/scripts/tools/admin-report.js",
    "/tests/smoke/cost-control.js",
    "/tests/e2e/full-flow.js",

    // 黑扩展名 —— 哪怕在根目录也不行
    "/server.js",
    "/monitor-server.js",
    "/package.json",
    "/package-lock.json",
    "/README.md",
    "/CLAUDE.md",
    "/docs/DEPLOYMENT.md",
    "/docs/ARCHITECTURE.md",
    "/Dockerfile",
    "/nginx.book-of-elon.conf.example",

    // 路径穿越尝试
    "/data/../server.js",
    "/../etc/passwd",
    "/%2e%2e/%2e%2e/etc/passwd",

    // Phase C-1：前后端分离后，web/ 是内部目录，URL 不暴露 /web/ 前缀
    "/web/index.html",
    "/web/app.js",
    "/web/book-source.js",
  ];
  for (const p of deny) {
    const r = await request(p);
    const ok = r.status === 404 || r.status === 403;
    assert(ok, `${p} → 404/403 (got ${r.status}, body ${r.bodyLen}b)`);
  }

  // ────────────────────────────────────────────────────────────
  // 边界：黑名单内的"合法扩展名"也必须挡（防止 /scripts/xxx.js 之类）
  // ────────────────────────────────────────────────────────────
  console.log("\n【边界：黑名单目录内 .js / .json 也应 404】");
  const denyEdge = [
    "/db/database.js",
    "/auth/session.js",
    "/routes/me.js",
    "/services/fact-extractor.js",
    "/data/business-metrics.json",
  ];
  for (const p of denyEdge) {
    const r = await request(p);
    assert(r.status === 404, `${p} → 404 (got ${r.status})`);
  }

  console.log("");
  if (failures > 0) {
    console.error(`\n✗ static-security smoke: ${failures} failure(s)`);
    process.exit(1);
  }
  console.log("✓ static-security smoke: all assertions passed");
})().catch((err) => {
  console.error("\n✗ smoke crashed:", err);
  process.exit(1);
});
