"use strict";

// ════════════════════════════════════════════════════════════════
// scripts/smoke-cost-control.js — R-01 烟雾测试
// ────────────────────────────────────────────────────────────────
// 不依赖 HTTP / DB / DeepSeek，纯函数级验证 services/cost-control 的三道闸：
//   1. 全站每日 token 总额
//   2. 单 IP 每日 token 配额
//   3. 匿名 session 每日 chat 次数
//
// 用法： node scripts/smoke-cost-control.js
// 退出码：0 全过 / 1 任一失败
// ════════════════════════════════════════════════════════════════

// 用合规下限做测试（cost-control 自身有 min 范围保护，把笔误的小值挡掉）
process.env.DAILY_TOTAL_TOKEN_BUDGET = "10000";
process.env.DAILY_TOKEN_PER_IP = "1000";
process.env.DAILY_ANON_CHAT_PER_SESSION = "3";

const cc = require("../../services/cost-control");

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.error(`  ✗ ${label}`);
    failed += 1;
  }
}

function section(title, fn) {
  console.log(`\n[${title}]`);
  cc._reset();
  fn();
}

// 1. config 读到 env
section("config 读取 env", () => {
  const cfg = cc._config();
  assert(cfg.DAILY_TOTAL_TOKEN_BUDGET === 10000, "DAILY_TOTAL_TOKEN_BUDGET=10000");
  assert(cfg.DAILY_TOKEN_PER_IP === 1000, "DAILY_TOKEN_PER_IP=1000");
  assert(cfg.DAILY_ANON_CHAT_PER_SESSION === 3, "DAILY_ANON_CHAT_PER_SESSION=3");
});

// 2. 正常路径放行
section("正常路径", () => {
  const r = cc.preflightChat({
    ip: "1.2.3.4",
    anonSessionId: "anon-a",
    isAuthenticated: false,
  });
  assert(r.ok === true, "首次请求 ok=true");
});

// 3. 匿名次数耗尽
section("匿名 session 每日次数", () => {
  for (let i = 0; i < 3; i++) {
    const r = cc.preflightChat({
      ip: "10.0.0.1",
      anonSessionId: "anon-b",
      isAuthenticated: false,
    });
    assert(r.ok === true, `第 ${i + 1} 次 ok`);
  }
  const blocked = cc.preflightChat({
    ip: "10.0.0.1",
    anonSessionId: "anon-b",
    isAuthenticated: false,
  });
  assert(blocked.ok === false, "第 4 次被挡");
  assert(blocked.reason === "anon_daily_chat_exhausted", "原因=anon_daily_chat_exhausted");
  assert(typeof blocked.retryAfterSeconds === "number" && blocked.retryAfterSeconds > 0, "retryAfter > 0");
});

// 4. 已登录用户不受匿名次数限制
section("已登录用户跳过匿名次数限", () => {
  for (let i = 0; i < 10; i++) {
    const r = cc.preflightChat({
      ip: "11.0.0.1",
      anonSessionId: "logged-in-user",
      isAuthenticated: true,
    });
    assert(r.ok === true, `登录用户第 ${i + 1} 次仍 ok`);
  }
});

// 5. 单 IP 配额（cap = 1000 token）
section("单 IP 每日 token 配额", () => {
  const ip = "20.20.20.20";
  cc.preflightChat({ ip, anonSessionId: "x", isAuthenticated: true });
  cc.recordTokenUsage({ ip, totalTokens: 400 });
  cc.recordTokenUsage({ ip, totalTokens: 600 });
  // 现在 IP 已经 1000 token（达到上限），下一次 preflight 应被挡
  const blocked = cc.preflightChat({ ip, anonSessionId: "x", isAuthenticated: true });
  assert(blocked.ok === false, "IP 用完后被挡");
  assert(blocked.reason === "ip_daily_quota_exhausted", "原因=ip_daily_quota_exhausted");
});

// 6. 全站熔断（cap = 10000 token）
section("全站每日 token 总额", () => {
  // 20 个不同 IP 各 500 token = 10000 token，触顶
  for (let i = 0; i < 20; i++) {
    const ip = `30.0.${Math.floor(i / 256)}.${i % 256}`;
    cc.preflightChat({ ip, anonSessionId: `s${i}`, isAuthenticated: true });
    cc.recordTokenUsage({ ip, totalTokens: 500 });
  }
  const blocked = cc.preflightChat({
    ip: "30.99.99.99",
    anonSessionId: "fresh",
    isAuthenticated: true,
  });
  assert(blocked.ok === false, "全站满了之后即使新 IP 也被挡");
  assert(blocked.reason === "daily_budget_exhausted", "原因=daily_budget_exhausted");
});

// 7. snapshot 字段完整
section("snapshot 字段完整", () => {
  cc._reset();
  cc.preflightChat({ ip: "1.1.1.1", anonSessionId: "z", isAuthenticated: true });
  cc.recordTokenUsage({ ip: "1.1.1.1", totalTokens: 50 });
  const snap = cc.snapshot();
  assert(typeof snap.date === "string", "date 字段");
  assert(snap.global.tokens_used === 50, "global.tokens_used = 50");
  assert(snap.global.tokens_budget === 10000, "global.tokens_budget = 10000");
  assert(typeof snap.global.utilization_pct === "number", "utilization_pct 是数字");
  assert(snap.caps.per_ip_daily_tokens === 1000, "caps.per_ip_daily_tokens = 1000");
  assert(snap.caps.per_anon_session_daily_chats === 3, "caps.per_anon_session_daily_chats");
});

console.log(`\n────────────────────`);
console.log(`Total: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
