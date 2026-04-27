"use strict";

// ════════════════════════════════════════════════════════════════
// services/cost-control.js
// ────────────────────────────────────────────────────────────────
// 在 rate limit / circuit breaker 之上再加一层「按天 + 按额度」的硬上限。
//
// 触发场景（生于 2026-04 那次 DeepSeek 3 天烧掉 ¥100 之后）：
//   - rate limit 是 8 req/min/IP，但攻击者轮 IP 可绕过
//   - max_tokens=400 是单次上限，没有跨请求累计
//   - 没有「全站今天总共烧了多少 token」的全局熔断
//   - 匿名用户没有任何按身份的限制（cookie 也能换）
//
// 三道关：
//   1. 全站每日 token 总额（DAILY_TOTAL_TOKEN_BUDGET，默认 2,000,000 ≈ ¥10/天）
//   2. 单 IP 每日 token 配额（DAILY_TOKEN_PER_IP，默认 50,000）
//   3. 匿名 session 每日 chat 次数（DAILY_ANON_CHAT_PER_SESSION，默认 20）
//
// 超额行为：preflightChat() 返回 { ok:false, reason }，调用方应走本地 fallback
// （用户体验保持平滑，不直接 429），同时 logEvent warning 让运维感知。
//
// 配额按 UTC 日期切片，跨过 UTC 0 点自动重置。
//
// 这是内存级的状态。重启后归零（这是可接受的 — 攻击者要利用必须保持 burst
// 速率，rate limiter 会先挡）。多实例部署时需要替换为共享存储。
// ════════════════════════════════════════════════════════════════

function readNumberEnv(name, def, min, max) {
  const v = Number(process.env[name]);
  if (Number.isFinite(v) && v >= min && v <= max) return v;
  return def;
}

const DAILY_TOTAL_TOKEN_BUDGET = readNumberEnv(
  "DAILY_TOTAL_TOKEN_BUDGET",
  2_000_000, // ~ ¥10/day at deepseek-chat 价格
  10_000,
  100_000_000
);
const DAILY_TOKEN_PER_IP = readNumberEnv(
  "DAILY_TOKEN_PER_IP",
  50_000, // 合法用户每天极大上限
  1_000,
  10_000_000
);
const DAILY_ANON_CHAT_PER_SESSION = readNumberEnv(
  "DAILY_ANON_CHAT_PER_SESSION",
  20,
  1,
  1000
);

const MAX_TRACKED_IPS = 5000;
const MAX_TRACKED_ANON = 10000;

let globalState = newGlobalState();
const ipState = new Map(); // ip -> { date, tokens, lastSeen }
const anonState = new Map(); // anonSessionId -> { date, count, lastSeen }

function newGlobalState() {
  return { date: todayKey(), tokens: 0, requests: 0 };
}

function todayKey() {
  // UTC 日期，避免服务器时区问题
  return new Date().toISOString().slice(0, 10);
}

function rotateGlobalIfNewDay() {
  const today = todayKey();
  if (globalState.date !== today) {
    globalState = newGlobalState();
  }
}

function rotateBucketIfNewDay(bucket, kind) {
  const today = todayKey();
  if (bucket.date !== today) {
    bucket.date = today;
    if (kind === "ip") bucket.tokens = 0;
    if (kind === "anon") bucket.count = 0;
  }
}

function secondsUntilUtcMidnight() {
  const now = new Date();
  const next = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1
  );
  return Math.max(60, Math.ceil((next - now.getTime()) / 1000));
}

// 执行前调用：检查是否能继续（不消耗 token，但消耗匿名次数）。
// 返回 { ok, reason?, retryAfterSeconds?, hint? }
//   reason ∈ daily_budget_exhausted | ip_daily_quota_exhausted | anon_daily_chat_exhausted
function preflightChat({ ip, anonSessionId, isAuthenticated }) {
  rotateGlobalIfNewDay();

  if (globalState.tokens >= DAILY_TOTAL_TOKEN_BUDGET) {
    return {
      ok: false,
      reason: "daily_budget_exhausted",
      retryAfterSeconds: secondsUntilUtcMidnight(),
      hint: "服务今日总额度已用完，明天再来试试。",
    };
  }

  if (ip) {
    const bucket = getOrCreateIpBucket(ip);
    rotateBucketIfNewDay(bucket, "ip");
    if (bucket.tokens >= DAILY_TOKEN_PER_IP) {
      return {
        ok: false,
        reason: "ip_daily_quota_exhausted",
        retryAfterSeconds: secondsUntilUtcMidnight(),
        hint: "你今天的请求量已经达到单 IP 上限。",
      };
    }
  }

  if (!isAuthenticated && anonSessionId) {
    const bucket = getOrCreateAnonBucket(anonSessionId);
    rotateBucketIfNewDay(bucket, "anon");
    if (bucket.count >= DAILY_ANON_CHAT_PER_SESSION) {
      return {
        ok: false,
        reason: "anon_daily_chat_exhausted",
        retryAfterSeconds: secondsUntilUtcMidnight(),
        hint: "未登录用户每天有体验次数上限，登录后可继续。",
      };
    }
    bucket.count += 1;
    bucket.lastSeen = Date.now();
  }

  globalState.requests += 1;
  return { ok: true };
}

// LLM 真的调用并拿到 usage 后调用，把 token 累计上去。
function recordTokenUsage({ ip, totalTokens }) {
  const t = Number(totalTokens);
  if (!Number.isFinite(t) || t <= 0) return;
  rotateGlobalIfNewDay();
  globalState.tokens += t;
  if (ip) {
    const bucket = getOrCreateIpBucket(ip);
    rotateBucketIfNewDay(bucket, "ip");
    bucket.tokens += t;
    bucket.lastSeen = Date.now();
  }
}

function getOrCreateIpBucket(ip) {
  let b = ipState.get(ip);
  if (!b) {
    if (ipState.size >= MAX_TRACKED_IPS) evictOldest(ipState);
    b = { date: todayKey(), tokens: 0, lastSeen: Date.now() };
    ipState.set(ip, b);
  }
  return b;
}

function getOrCreateAnonBucket(id) {
  let b = anonState.get(id);
  if (!b) {
    if (anonState.size >= MAX_TRACKED_ANON) evictOldest(anonState);
    b = { date: todayKey(), count: 0, lastSeen: Date.now() };
    anonState.set(id, b);
  }
  return b;
}

function evictOldest(map) {
  // 简单 LRU：删最早 lastSeen 的 10%
  const entries = Array.from(map.entries());
  entries.sort((a, b) => a[1].lastSeen - b[1].lastSeen);
  const drop = Math.max(1, Math.floor(entries.length * 0.1));
  for (let i = 0; i < drop; i++) map.delete(entries[i][0]);
}

function cleanupExpired() {
  const today = todayKey();
  for (const [k, v] of ipState) {
    if (v.date !== today) ipState.delete(k);
  }
  for (const [k, v] of anonState) {
    if (v.date !== today) anonState.delete(k);
  }
}

function snapshot() {
  rotateGlobalIfNewDay();
  const utilization = DAILY_TOTAL_TOKEN_BUDGET
    ? Math.round((globalState.tokens / DAILY_TOTAL_TOKEN_BUDGET) * 1000) / 10
    : 0;
  return {
    date: globalState.date,
    global: {
      tokens_used: globalState.tokens,
      tokens_budget: DAILY_TOTAL_TOKEN_BUDGET,
      utilization_pct: utilization,
      requests_today: globalState.requests,
    },
    caps: {
      per_ip_daily_tokens: DAILY_TOKEN_PER_IP,
      per_anon_session_daily_chats: DAILY_ANON_CHAT_PER_SESSION,
    },
    tracked_ips: ipState.size,
    tracked_anon_sessions: anonState.size,
  };
}

module.exports = {
  preflightChat,
  recordTokenUsage,
  cleanupExpired,
  snapshot,
  // testing helpers
  _reset() {
    globalState = newGlobalState();
    ipState.clear();
    anonState.clear();
  },
  _config() {
    return {
      DAILY_TOTAL_TOKEN_BUDGET,
      DAILY_TOKEN_PER_IP,
      DAILY_ANON_CHAT_PER_SESSION,
    };
  },
};
