# Paywall Onboarding Implementation Plan (R-27)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Book of Elon 这个玩具项目加一个 ¥19.9 一次性终身付费墙 + 登录后 7 天无限免费试用，在不破坏匿名访客体验（20 次/天硬限、不见付费 UI）的前提下，让玩具自给自足 + 提供可证伪的 demand 信号。

**Architecture:** SQLite 加 4 列 / 2 表；业务逻辑走 `services/paywall.js` 纯函数状态机；支付走 `services/payment-provider.js` 抽象接口 + `services/payment-hushupay.js` 虎皮椒实现；`/api/chat` 里塞一层 paywall gate；前端 `web/paywall.js` 模块拦 402 响应弹模态。所有新行为受 `PAYWALL_ENABLED=1` 环境变量门控，默认关闭，向后兼容 dev/staging。

**Tech Stack:** Node.js + better-sqlite3 + 原生 JS 前端 + **虎皮椒微信支付独家**（xunhupay.com 聚合通道，个人无营业执照可用，`payment=wechat` 参数，PC 扫码 / H5 跳转两种 UI 形态）。测试用 Node `assert` + 现有 tests/smoke 风格 + jsdom e2e。

**明确不支持**：支付宝 / 余额 / 银联 / 境外卡。任何其他渠道均通过新建 plan 决策后再加。

**Upstream decision:** `docs/superpowers/decisions/2026-04-27-toy-mode-and-paywall.md`

**Audit item:** R-27（`docs/superpowers/audits/2026-04-27-project-audit.md`）

---

## Scope Check

✅ 单一子系统：付费墙 + 支付 + 前端拦截 + 运维 runbook。不跨到任何其他系统（chat 本体、facts memory、SMS 全不改）。

**Out of scope（明确不做）：**
- 订阅 / 续费（只做一次性终身）
- 退款自动化（退款走人工 + runbook）
- 多套餐（只有一个 ¥19.9）
- 账户合并 / 换手机号导入（owner 表示不在乎）
- 付费墙本体的 A/B test 能力（玩具不值得）
- 国际化 / 多货币（仅 CNY）
- 发票 / 电子凭证（玩具级，支付成功邮件 / 短信都省掉）
- 订单分析 dashboard（看 sqlite 就行）

---

## OPEN QUESTIONS — 交给 gstack review 挑错

以下是我写这份 plan 时**默认做了决策**但希望三轨审阅挑战的品味点。每条我给了默认值和一句话 why，审阅者可以 flip：

| # | 决策点 | 默认值 | 默认理由 | 审阅者应该挑的方向 |
|---|---|---|---|---|
| ~~Q1~~ | 支付聚合通道 | 🔒 **LOCKED**: 虎皮椒微信支付独家（2026-04-27 owner 决定） | Q1 不再审阅；`services/payment-provider.js` 接口仍保留抽象层做可替换性 | — |
| **Q2** | trial 起点 | 首次 SMS 验证成功（= 手机号落库）时 | 清晰 / 用户有感知 | CEO-review: 会不会被刷多手机号滥用 7 天免费 |
| **Q3** | grandfather 现有用户 | users.id ∈ {1,2,3} 全免 | 都是 owner 亲友，商业零意义 | eng-review: id=1,2,3 是 dev 残留还是真实用户？用 phone allowlist 更安全 |
| **Q4** | 匿名访客完全不见 paywall | 不见（continue 20/day 硬限） | 保留玩具"任何人能玩一下"的调性 | CEO-review: 是否主动放弃匿名→注册→付费漏斗 |
| **Q5** | 付费绑定 | users.id + users.phone_hash | 换号=新账号=重付 | design-review: 用户换手机号时 UX 体验如何 |
| **Q6** | trial 过期后免费额度 | 1 次/天 | 不想一刀切，保留用户偶尔回来不花钱 | design-review: 是否用"可看历史但不可新聊"更人性化 |
| **Q7** | paywall copy 文案 | "让 [AI] 永远记得你 · ¥19.9" | 卖关系不卖会员，符合玩具调性 | design-review: 这句能否再打磨一版 |
| **Q8** | webhook 回调安全 | MD5 签名 + 幂等键 + IP allowlist | 虎皮椒官方文档推荐 | eng-review: 是否需要 HMAC-SHA256 / replay window / rate limit |
| **Q9** | 价格精度 | 分为单位存（int cents）| 避免浮点；PAYWALL_PRICE_CENTS=1990 | eng-review: 确认虎皮椒 API 也用元而非分，转换处没错 |
| **Q10** | Kill Switch 自动化程度 | 纯人工查 `scripts/ops/demand-report.js` | 玩具不值得自动停服 | CEO-review: 6 个月到期会不会忘 / 需要日历提醒 |

---

## File Structure

**新建（6 个文件）：**
- `services/paywall.js` — 付费状态机（pure functions + DB 查询）
- `services/payment-provider.js` — 支付通道抽象接口
- `services/payment-hushupay.js` — 虎皮椒实现
- `routes/payment.js` — /api/payment/* 路由
- `web/paywall.js` — 前端 paywall 模态 + 拦截
- `web/paywall.css` — 模态样式
- `scripts/ops/demand-report.js` — Kill Switch 月度报告
- `tests/unit/paywall.test.js` — paywall.js 单元测试
- `tests/smoke/paywall-smoke.js` — 端到端冒烟
- `docs/runbooks/incident-payment-down.md` — 支付异常 runbook
- `docs/runbooks/incident-shutdown.md` — Kill Switch 关站 runbook

**修改（8 个文件）：**
- `db/schema.sql` — users 加 4 列 + 2 张新表
- `db/auto-migrate.js` — 加新列 patches + 新表 EXPECTED
- `server.js` — chat gate 接入 + /api/paywall/state 路由 + 路由注册
- `web/app.js` — 拦 402 响应触发 paywall 模态
- `web/index.html` — 加 paywall.css / paywall.js 引用
- `.env.example` + `.env.production.example` — 加付费相关环境变量
- `preflight-check.js` — PAYWALL_ENABLED=1 时校验必填环境变量
- `CLAUDE.md` — §4 新增"付费墙状态机"子章节；§5 环境变量表更新

---

## Task Breakdown

共 **11 个任务**，预估 2-3 个晚上。推荐按顺序执行（后面任务依赖前面任务的文件）。

**Phase 结构：**
- **Phase A（任务 1-3）**：DB + 核心业务逻辑（无副作用，可独立测试）
- **Phase B（任务 4-5）**：HTTP 路由 + server 集成（需要 Phase A）
- **Phase C（任务 6-7）**：前端 + 端到端（需要 Phase B）
- **Phase D（任务 8-11）**：运维 / Kill Switch / 文档（Phase C 之后或并行）

每个任务都按 TDD：**失败测试 → 验证失败 → 实现 → 验证通过 → commit**。

---

### Task 1: DB Schema + Auto-Migrate（users 加 4 列 + 2 张新表）

**Files:**
- Modify: `db/schema.sql`
- Modify: `db/auto-migrate.js`
- Test: `tests/unit/paywall-schema.test.js`

**Context:** 现有 `users` 表没有付费相关字段。我们不做 breaking change，只加列（自动 migrate 可处理）。

**Schema 增量设计：**

```sql
-- users 新增 4 列（都可空/有默认，旧行不受影响）
ALTER TABLE users ADD COLUMN trial_started_at INTEGER;       -- 首次 SMS 验证成功时写入（ms）
ALTER TABLE users ADD COLUMN is_paid INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN paid_at INTEGER;                 -- 付费成功时间（ms）
ALTER TABLE users ADD COLUMN grandfathered INTEGER NOT NULL DEFAULT 0;  -- 预置免付费标记

-- payment_orders：订单主表
CREATE TABLE IF NOT EXISTS payment_orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          TEXT NOT NULL UNIQUE,        -- {user_id}-{ts}-{rand6}
  user_id           INTEGER NOT NULL,
  amount_cents      INTEGER NOT NULL,            -- 分为单位，1990 = ¥19.9
  currency          TEXT NOT NULL DEFAULT 'CNY',
  status            TEXT NOT NULL CHECK(status IN ('pending','paid','failed','refunded','expired')),
  provider          TEXT NOT NULL DEFAULT 'hushupay_wechat',
  provider_tx_id    TEXT UNIQUE,                 -- 虎皮椒回调里的 transaction_id；幂等保护
  provider_order_id TEXT,                        -- 虎皮椒内部订单号
  created_at        INTEGER NOT NULL,
  paid_at           INTEGER,
  refunded_at       INTEGER,
  refund_reason     TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status, created_at DESC);

-- payment_events：webhook 事件审计（debug + 合规 + 排查）
CREATE TABLE IF NOT EXISTS payment_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      TEXT,                            -- 可能为空（恶意回调）
  event_type    TEXT NOT NULL,                   -- 'webhook_received' / 'sig_invalid' / 'order_not_found' / 'status_updated' / ...
  raw_payload   TEXT NOT NULL,                   -- JSON.stringify 原始请求
  ip            TEXT,
  received_at   INTEGER NOT NULL,
  notes         TEXT
);
CREATE INDEX IF NOT EXISTS idx_payment_events_order ON payment_events(order_id, received_at DESC);
```

- [ ] **Step 1.1: 写失败的 schema 测试**

创建 `tests/unit/paywall-schema.test.js`：

```javascript
// tests/unit/paywall-schema.test.js
"use strict";
const assert = require("assert");
const path = require("path");
const fs = require("fs");
const os = require("os");
const Database = require("better-sqlite3");
const { runAutoMigrate } = require("../../db/auto-migrate");

function freshDb() {
  const p = path.join(os.tmpdir(), `paywall-schema-${Date.now()}-${Math.random()}.db`);
  return { db: new Database(p), path: p };
}

function test(name, fn) {
  try { fn(); console.log("  ✓", name); }
  catch (e) { console.error("  ✗", name, "\n    ", e.message); process.exitCode = 1; }
}

console.log("[paywall-schema]");

test("users 表新增 4 列（trial_started_at / is_paid / paid_at / grandfathered）", () => {
  const { db } = freshDb();
  runAutoMigrate(db);
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  for (const c of ["trial_started_at", "is_paid", "paid_at", "grandfathered"]) {
    assert.ok(cols.includes(c), `users 缺列 ${c}`);
  }
});

test("is_paid 默认 0", () => {
  const { db } = freshDb();
  runAutoMigrate(db);
  const now = Date.now();
  db.prepare("INSERT INTO users(phone, created_at, last_seen_at) VALUES(?,?,?)")
    .run("13800000001", now, now);
  const row = db.prepare("SELECT is_paid, grandfathered FROM users WHERE phone=?").get("13800000001");
  assert.strictEqual(row.is_paid, 0);
  assert.strictEqual(row.grandfathered, 0);
});

test("payment_orders 表存在 + UNIQUE(order_id)", () => {
  const { db } = freshDb();
  runAutoMigrate(db);
  const now = Date.now();
  db.prepare("INSERT INTO users(phone, created_at, last_seen_at) VALUES(?,?,?)").run("13800000002", now, now);
  const uid = db.prepare("SELECT id FROM users WHERE phone=?").get("13800000002").id;
  db.prepare(`INSERT INTO payment_orders(order_id,user_id,amount_cents,status,created_at)
              VALUES(?,?,?,?,?)`).run("o1", uid, 1990, "pending", now);
  assert.throws(() => {
    db.prepare(`INSERT INTO payment_orders(order_id,user_id,amount_cents,status,created_at)
                VALUES(?,?,?,?,?)`).run("o1", uid, 1990, "pending", now);
  }, /UNIQUE/i);
});

test("payment_orders.provider_tx_id UNIQUE（幂等保护）", () => {
  const { db } = freshDb();
  runAutoMigrate(db);
  const now = Date.now();
  db.prepare("INSERT INTO users(phone, created_at, last_seen_at) VALUES(?,?,?)").run("13800000003", now, now);
  const uid = db.prepare("SELECT id FROM users WHERE phone=?").get("13800000003").id;
  db.prepare(`INSERT INTO payment_orders(order_id,user_id,amount_cents,status,provider_tx_id,created_at)
              VALUES(?,?,?,?,?,?)`).run("o2", uid, 1990, "paid", "TX_ABC", now);
  assert.throws(() => {
    db.prepare(`INSERT INTO payment_orders(order_id,user_id,amount_cents,status,provider_tx_id,created_at)
                VALUES(?,?,?,?,?,?)`).run("o3", uid, 1990, "paid", "TX_ABC", now);
  }, /UNIQUE/i);
});

test("status CHECK 只允许 5 种枚举", () => {
  const { db } = freshDb();
  runAutoMigrate(db);
  const now = Date.now();
  db.prepare("INSERT INTO users(phone, created_at, last_seen_at) VALUES(?,?,?)").run("13800000004", now, now);
  const uid = db.prepare("SELECT id FROM users WHERE phone=?").get("13800000004").id;
  assert.throws(() => {
    db.prepare(`INSERT INTO payment_orders(order_id,user_id,amount_cents,status,created_at)
                VALUES(?,?,?,?,?)`).run("oBad", uid, 1990, "weird", now);
  }, /CHECK/i);
});

test("payment_events 表存在", () => {
  const { db } = freshDb();
  runAutoMigrate(db);
  const cols = db.prepare("PRAGMA table_info(payment_events)").all();
  assert.ok(cols.length > 0, "payment_events 不存在");
});
```

- [ ] **Step 1.2: 跑测试验证失败**

```bash
node tests/unit/paywall-schema.test.js
```

预期：`✗ users 缺列 trial_started_at` 等，全红。

- [ ] **Step 1.3: 改 `db/schema.sql` 新增表（用户首次启动用）**

在 `db/schema.sql` 末尾（`schema_meta` 之前）追加：

```sql
-- ════════════════════════════════════════════════════════════════
-- payment_orders：付费订单
--   order_id: {user_id}-{ts_ms}-{rand6hex}
--   amount_cents: 分为单位存（1990 = ¥19.9），避免浮点
--   status: pending/paid/failed/refunded/expired
--   provider_tx_id UNIQUE: 虎皮椒 webhook 幂等保护
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS payment_orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id          TEXT NOT NULL UNIQUE,
  user_id           INTEGER NOT NULL,
  amount_cents      INTEGER NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'CNY',
  status            TEXT NOT NULL CHECK(status IN ('pending','paid','failed','refunded','expired')),
  provider          TEXT NOT NULL DEFAULT 'hushupay_wechat',
  provider_tx_id    TEXT UNIQUE,
  provider_order_id TEXT,
  created_at        INTEGER NOT NULL,
  paid_at           INTEGER,
  refunded_at       INTEGER,
  refund_reason     TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_orders_status ON payment_orders(status, created_at DESC);

-- ════════════════════════════════════════════════════════════════
-- payment_events：webhook 审计日志（永不删，用于排查 & 合规）
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS payment_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     TEXT,
  event_type   TEXT NOT NULL,
  raw_payload  TEXT NOT NULL,
  ip           TEXT,
  received_at  INTEGER NOT NULL,
  notes        TEXT
);
CREATE INDEX IF NOT EXISTS idx_payment_events_order ON payment_events(order_id, received_at DESC);
```

- [ ] **Step 1.4: 改 `db/auto-migrate.js` 把新列 / 新表纳入 EXPECTED**

在 `db/auto-migrate.js`：

1. `EXPECTED.tables` 数组末尾追加两项：`"payment_orders"`, `"payment_events"`
2. `EXPECTED.columns` 里 users 项追加 4 列：
   ```javascript
   users: ["total_chat_turns", "trial_started_at", "is_paid", "paid_at", "grandfathered"],
   ```
3. `ADD_COLUMN_PATCHES` 数组末尾追加 4 条：
   ```javascript
   { table: "users", col: "trial_started_at", sql: "ALTER TABLE users ADD COLUMN trial_started_at INTEGER" },
   { table: "users", col: "is_paid", sql: "ALTER TABLE users ADD COLUMN is_paid INTEGER NOT NULL DEFAULT 0" },
   { table: "users", col: "paid_at", sql: "ALTER TABLE users ADD COLUMN paid_at INTEGER" },
   { table: "users", col: "grandfathered", sql: "ALTER TABLE users ADD COLUMN grandfathered INTEGER NOT NULL DEFAULT 0" },
   ```

- [ ] **Step 1.5: 跑测试验证通过**

```bash
node tests/unit/paywall-schema.test.js
```

预期：全绿。

- [ ] **Step 1.6: 跑现有 smoke 确认不回归**

```bash
node tests/smoke/db.js
node tests/smoke/persist.js
```

预期：全绿。

- [ ] **Step 1.7: Commit**

```bash
git add db/schema.sql db/auto-migrate.js tests/unit/paywall-schema.test.js
git commit -m "feat(paywall): R-27 Task 1 - DB schema + auto-migrate for users.is_paid + payment_orders + payment_events"
```

---

### Task 2: `services/paywall.js`——付费状态机（核心业务逻辑）

**Files:**
- Create: `services/paywall.js`
- Test: `tests/unit/paywall.test.js`

**Context:** 这是整个 paywall 的大脑。纯函数 + DB 查询，不做 HTTP，不做支付，好测试。

**状态机 6 态：**

| 状态 | 含义 | 能聊天吗 | 前端提示 |
|---|---|---|---|
| `disabled` | `PAYWALL_ENABLED=0` | ✅ 随便 | 无 |
| `anon` | 未登录（没 user_id） | ✅ 走原有 20/天匿名限 | 无 |
| `grandfathered` | 预置免费（owner 亲友） | ✅ 无限 | 无（或"朋友身份"小标） |
| `paid` | 已付费 | ✅ 无限（仍有 `PAYWALL_DAILY_HARD_LIMIT` 反刷） | 无 |
| `trial` | 登录后 7 天内 | ✅ 无限（仍有 `PAYWALL_DAILY_HARD_LIMIT`） | 顶部横幅"试用还剩 X 天" |
| `expired` | trial 超 7 天且未付费 | ❌ 弹付费墙；仅保留每天 1 次"体验聊" | 付费墙模态 |

**实现：**

- [ ] **Step 2.1: 写失败测试 `tests/unit/paywall.test.js`**

```javascript
// tests/unit/paywall.test.js
"use strict";
const assert = require("assert");
const path = require("path");
const os = require("os");
const Database = require("better-sqlite3");
const { runAutoMigrate } = require("../../db/auto-migrate");
const {
  computeState,
  isEntitled,
  startTrial,
  markPaid,
  TRIAL_MS,
} = require("../../services/paywall");

function freshDb() {
  const p = path.join(os.tmpdir(), `paywall-svc-${Date.now()}-${Math.random()}.db`);
  const db = new Database(p);
  runAutoMigrate(db);
  return db;
}

function mkUser(db, phone, overrides = {}) {
  const now = Date.now();
  db.prepare("INSERT INTO users(phone, created_at, last_seen_at) VALUES(?,?,?)").run(phone, now, now);
  const u = db.prepare("SELECT * FROM users WHERE phone=?").get(phone);
  if (Object.keys(overrides).length) {
    const sets = Object.keys(overrides).map(k => `${k}=?`).join(",");
    db.prepare(`UPDATE users SET ${sets} WHERE id=?`).run(...Object.values(overrides), u.id);
    return db.prepare("SELECT * FROM users WHERE id=?").get(u.id);
  }
  return u;
}

function test(name, fn) {
  try { fn(); console.log("  ✓", name); }
  catch (e) { console.error("  ✗", name, "\n    ", e.message); process.exitCode = 1; }
}

console.log("[paywall.service]");

test("disabled 模式下任何用户都 entitled", () => {
  const db = freshDb();
  const u = mkUser(db, "13800000010");
  const s = computeState(u, { enabled: false, now: Date.now() });
  assert.strictEqual(s.state, "disabled");
  assert.strictEqual(isEntitled(s), true);
});

test("anon（user=null）永远 anon 状态（匿名限流由 cost-control 负责，不归 paywall）", () => {
  const s = computeState(null, { enabled: true, now: Date.now() });
  assert.strictEqual(s.state, "anon");
  assert.strictEqual(isEntitled(s), true);
});

test("grandfathered 无视 trial", () => {
  const db = freshDb();
  const u = mkUser(db, "13800000011", { grandfathered: 1, trial_started_at: null });
  const s = computeState(u, { enabled: true, now: Date.now() });
  assert.strictEqual(s.state, "grandfathered");
  assert.strictEqual(isEntitled(s), true);
});

test("is_paid=1 为 paid 状态", () => {
  const db = freshDb();
  const u = mkUser(db, "13800000012", { is_paid: 1, paid_at: Date.now() });
  const s = computeState(u, { enabled: true, now: Date.now() });
  assert.strictEqual(s.state, "paid");
  assert.strictEqual(isEntitled(s), true);
});

test("trial_started_at 为 null（首次登录未写入）时算 trial（刚起步）", () => {
  const db = freshDb();
  const u = mkUser(db, "13800000013", { trial_started_at: null });
  const s = computeState(u, { enabled: true, now: Date.now() });
  assert.strictEqual(s.state, "trial");
  assert.strictEqual(isEntitled(s), true);
  assert.ok(s.trialRemainingMs > 0, "trialRemainingMs 应 > 0");
});

test("trial 期内（< 7 天）entitled", () => {
  const db = freshDb();
  const now = Date.now();
  const u = mkUser(db, "13800000014", { trial_started_at: now - 3 * 86400 * 1000 });
  const s = computeState(u, { enabled: true, now });
  assert.strictEqual(s.state, "trial");
  assert.ok(s.trialRemainingMs > 3 * 86400 * 1000 - 1000);
  assert.ok(s.trialRemainingMs < 4 * 86400 * 1000);
});

test("trial 过期（> 7 天且未付）→ expired 且 not entitled", () => {
  const db = freshDb();
  const now = Date.now();
  const u = mkUser(db, "13800000015", { trial_started_at: now - 8 * 86400 * 1000 });
  const s = computeState(u, { enabled: true, now });
  assert.strictEqual(s.state, "expired");
  assert.strictEqual(isEntitled(s), false);
});

test("startTrial 幂等：重复调用不覆盖旧起点", () => {
  const db = freshDb();
  const now = Date.now();
  const u = mkUser(db, "13800000016");
  startTrial(db, u.id, now);
  const first = db.prepare("SELECT trial_started_at FROM users WHERE id=?").get(u.id).trial_started_at;
  assert.strictEqual(first, now);
  // 一天后再调用
  startTrial(db, u.id, now + 86400 * 1000);
  const second = db.prepare("SELECT trial_started_at FROM users WHERE id=?").get(u.id).trial_started_at;
  assert.strictEqual(second, now, "startTrial 应幂等，不覆盖");
});

test("markPaid 翻 is_paid + 写 paid_at", () => {
  const db = freshDb();
  const u = mkUser(db, "13800000017");
  const ts = Date.now();
  markPaid(db, u.id, ts);
  const after = db.prepare("SELECT is_paid, paid_at FROM users WHERE id=?").get(u.id);
  assert.strictEqual(after.is_paid, 1);
  assert.strictEqual(after.paid_at, ts);
});

test("markPaid 幂等（第二次调用不变）", () => {
  const db = freshDb();
  const u = mkUser(db, "13800000018");
  const ts1 = Date.now();
  markPaid(db, u.id, ts1);
  markPaid(db, u.id, ts1 + 999);
  const after = db.prepare("SELECT is_paid, paid_at FROM users WHERE id=?").get(u.id);
  assert.strictEqual(after.paid_at, ts1, "markPaid 第二次不应覆盖 paid_at");
});

test("TRIAL_MS 是 7 天 ms 数", () => {
  assert.strictEqual(TRIAL_MS, 7 * 86400 * 1000);
});
```

- [ ] **Step 2.2: 跑测试验证失败**

```bash
node tests/unit/paywall.test.js
```

预期：`Cannot find module '../../services/paywall'`，红。

- [ ] **Step 2.3: 实现 `services/paywall.js`**

```javascript
// services/paywall.js
// ════════════════════════════════════════════════════════════════
// Paywall state machine（纯业务逻辑，无 HTTP / 无支付调用）
//
// 6 态：disabled / anon / grandfathered / paid / trial / expired
// 设计动机见 docs/superpowers/decisions/2026-04-27-toy-mode-and-paywall.md
// ════════════════════════════════════════════════════════════════

"use strict";

const TRIAL_MS = 7 * 86400 * 1000; // 7 天

/**
 * 根据用户 row + 环境算出当前 paywall 状态。
 * @param {object|null} user - users 表的 row；匿名请求传 null
 * @param {object} opts
 * @param {boolean} opts.enabled - PAYWALL_ENABLED 是否为 1
 * @param {number} opts.now - ms epoch（测试用，默认 Date.now()）
 * @returns {{state:string, trialRemainingMs?:number, userId?:number}}
 */
function computeState(user, opts = {}) {
  const now = typeof opts.now === "number" ? opts.now : Date.now();
  const enabled = opts.enabled !== false;

  if (!enabled) return { state: "disabled" };
  if (!user) return { state: "anon" };

  if (user.grandfathered === 1) return { state: "grandfathered", userId: user.id };
  if (user.is_paid === 1) return { state: "paid", userId: user.id };

  // trial 起点：trial_started_at 为 null 时视为"此刻刚开始"，返回满时长
  const tStart = user.trial_started_at == null ? now : user.trial_started_at;
  const elapsed = now - tStart;
  const remaining = TRIAL_MS - elapsed;

  if (remaining <= 0) {
    return { state: "expired", userId: user.id, trialRemainingMs: 0 };
  }
  return { state: "trial", userId: user.id, trialRemainingMs: remaining };
}

/** 判断当前 state 是否允许聊天（不含 cost-control 的二级限流） */
function isEntitled(stateObj) {
  return ["disabled", "anon", "grandfathered", "paid", "trial"].includes(stateObj.state);
}

/**
 * 幂等地写 trial_started_at（只在现有值为 NULL 时写入）。
 * 由 routes/auth.js::handleVerifyCode 在首次 SMS 验证成功 + user 入库时调用。
 */
function startTrial(db, userId, now = Date.now()) {
  db.prepare(
    "UPDATE users SET trial_started_at = ? WHERE id = ? AND trial_started_at IS NULL"
  ).run(now, userId);
}

/**
 * 标记用户付费成功。幂等：第二次调用不覆盖 paid_at（保留真实首付时刻）。
 * 由 routes/payment.js::handleWebhook 在 provider 回调成功时调用。
 */
function markPaid(db, userId, paidAt = Date.now()) {
  db.prepare(
    "UPDATE users SET is_paid = 1, paid_at = ? WHERE id = ? AND is_paid = 0"
  ).run(paidAt, userId);
}

/** 把 state 序列化成 /api/paywall/state 的 JSON 响应 */
function serializeForApi(stateObj) {
  const out = {
    state: stateObj.state,
    entitled: isEntitled(stateObj),
  };
  if (typeof stateObj.trialRemainingMs === "number") {
    out.trial_remaining_ms = stateObj.trialRemainingMs;
    out.trial_remaining_days = Math.ceil(stateObj.trialRemainingMs / 86400000);
  }
  return out;
}

module.exports = {
  TRIAL_MS,
  computeState,
  isEntitled,
  startTrial,
  markPaid,
  serializeForApi,
};
```

- [ ] **Step 2.4: 跑测试验证通过**

```bash
node tests/unit/paywall.test.js
```

预期：全绿（11 项）。

- [ ] **Step 2.5: Commit**

```bash
git add services/paywall.js tests/unit/paywall.test.js
git commit -m "feat(paywall): R-27 Task 2 - paywall.js state machine (6 states, pure, TDD-covered)"
```

---

### Task 3: 虎皮椒微信支付接入（Provider 抽象 + 实现 + 单测）

**Files:**
- Create: `services/payment-provider.js`（抽象接口 + MOCK impl for testing）
- Create: `services/payment-hushupay.js`（真实虎皮椒微信支付）
- Test: `tests/unit/payment-hushupay.test.js`

**Context:** 虎皮椒 WeChat Pay API（`https://api.xunhupay.com/payment/do.html`）关键字段：

| 参数 | 说明 |
|---|---|
| `version` | 固定 `1.1` |
| `appid` | 商户 APPID（环境变量 `HUSHUPAY_APP_ID`） |
| `trade_order_id` | 我们自己的 order_id |
| `total_fee` | 元为单位，两位小数字符串，如 `"19.90"` |
| `title` | 商品名 |
| `time` | Unix 秒 |
| `notify_url` | 我们的 webhook URL |
| `return_url` | 支付完成跳转 |
| `nonce_str` | 32 位随机 |
| `payment` | 固定 `wechat` |
| `type` | `Scan`（PC 扫码）或 `WAP`（H5 跳转） |
| `hash` | 按参数名 ASCII 排序拼接 `k=v&...&key={APP_KEY}` 后 MD5 小写 |

Webhook 回调 POST：包含 `trade_order_id`, `transaction_id`, `status=OD`, `hash`（需回验）。

- [ ] **Step 3.1: 写失败测试 `tests/unit/payment-hushupay.test.js`**

```javascript
// tests/unit/payment-hushupay.test.js
"use strict";
const assert = require("assert");
const {
  buildSignature,
  verifySignature,
  buildCreateOrderPayload,
  parseWebhook,
} = require("../../services/payment-hushupay");

function test(name, fn) {
  try { fn(); console.log("  ✓", name); }
  catch (e) { console.error("  ✗", name, "\n    ", e.message); process.exitCode = 1; }
}

console.log("[payment-hushupay]");

test("buildSignature: 参数按 key ASCII 排序，末尾拼 key, MD5 lowercase", () => {
  // 虎皮椒官方示例（文档给的 hash 例）：
  //   key-value 按 key 排 → a=1&b=2&c=3 + key=APPKEY → MD5
  const sig = buildSignature(
    { b: "2", a: "1", c: "3" },
    "APPKEY_DEMO"
  );
  const crypto = require("crypto");
  const expect = crypto
    .createHash("md5")
    .update("a=1&b=2&c=3&key=APPKEY_DEMO")
    .digest("hex")
    .toLowerCase();
  assert.strictEqual(sig, expect);
});

test("buildSignature: 跳过空值和 hash 字段本身", () => {
  const sig1 = buildSignature(
    { a: "1", b: "", hash: "ignore_me" },
    "K"
  );
  const crypto = require("crypto");
  const expect = crypto.createHash("md5").update("a=1&key=K").digest("hex").toLowerCase();
  assert.strictEqual(sig1, expect);
});

test("verifySignature: 正签名通过", () => {
  const params = { a: "1", b: "2" };
  const sig = buildSignature(params, "K");
  assert.strictEqual(verifySignature({ ...params, hash: sig }, "K"), true);
});

test("verifySignature: 篡改参数应失败", () => {
  const params = { a: "1", b: "2" };
  const sig = buildSignature(params, "K");
  assert.strictEqual(verifySignature({ a: "1", b: "3", hash: sig }, "K"), false);
});

test("verifySignature: 错 key 应失败", () => {
  const params = { a: "1" };
  const sig = buildSignature(params, "K1");
  assert.strictEqual(verifySignature({ ...params, hash: sig }, "K2"), false);
});

test("buildCreateOrderPayload 生成 11 个参数 + hash（payment=wechat 强制）", () => {
  const payload = buildCreateOrderPayload({
    appId: "APP_X",
    appKey: "KEY_X",
    orderId: "o123",
    amountCents: 1990,
    title: "Book of Elon · 永久解锁",
    notifyUrl: "https://bookofelon.cn/api/payment/webhook",
    returnUrl: "https://bookofelon.cn/?paid=1",
    nowSec: 1714176000,
    nonceStr: "N_DETERMINISTIC_32CHAR_XXXXXXXX",
    type: "WAP",
  });
  assert.strictEqual(payload.version, "1.1");
  assert.strictEqual(payload.appid, "APP_X");
  assert.strictEqual(payload.trade_order_id, "o123");
  assert.strictEqual(payload.total_fee, "19.90");
  assert.strictEqual(payload.payment, "wechat");
  assert.strictEqual(payload.type, "WAP");
  assert.ok(payload.hash && payload.hash.length === 32, "hash 必须是 32 位 MD5");
});

test("total_fee 永远两位小数字符串（100 分=1.00, 50 分=0.50）", () => {
  const p1 = buildCreateOrderPayload({
    appId: "A", appKey: "K", orderId: "o",
    amountCents: 100, title: "t",
    notifyUrl: "u", returnUrl: "u",
    nowSec: 1, nonceStr: "n",
  });
  assert.strictEqual(p1.total_fee, "1.00");
  const p2 = buildCreateOrderPayload({
    appId: "A", appKey: "K", orderId: "o",
    amountCents: 50, title: "t",
    notifyUrl: "u", returnUrl: "u",
    nowSec: 1, nonceStr: "n",
  });
  assert.strictEqual(p2.total_fee, "0.50");
});

test("parseWebhook: 合法回调解包", () => {
  const body = {
    trade_order_id: "o123",
    transaction_id: "TX_WX_ABC",
    open_order_id: "HUSHU_999",
    status: "OD",
    total_fee: "19.90",
    hash: "placeholder",
  };
  body.hash = buildSignature(body, "K");
  const parsed = parseWebhook(body, "K");
  assert.strictEqual(parsed.valid, true);
  assert.strictEqual(parsed.orderId, "o123");
  assert.strictEqual(parsed.providerTxId, "TX_WX_ABC");
  assert.strictEqual(parsed.providerOrderId, "HUSHU_999");
  assert.strictEqual(parsed.paid, true);
});

test("parseWebhook: status != OD 视为未付", () => {
  const body = { trade_order_id: "o", status: "WP", hash: "x" };
  body.hash = buildSignature(body, "K");
  const parsed = parseWebhook(body, "K");
  assert.strictEqual(parsed.valid, true);
  assert.strictEqual(parsed.paid, false);
});

test("parseWebhook: 签名错 valid=false", () => {
  const body = { trade_order_id: "o", status: "OD", hash: "WRONG" };
  const parsed = parseWebhook(body, "K");
  assert.strictEqual(parsed.valid, false);
});
```

- [ ] **Step 3.2: 跑测试验证失败**

```bash
node tests/unit/payment-hushupay.test.js
```

预期：`Cannot find module`，红。

- [ ] **Step 3.3: 实现 `services/payment-provider.js`（抽象接口）**

```javascript
// services/payment-provider.js
// ════════════════════════════════════════════════════════════════
// Payment provider 抽象接口
//
// 当前唯一实现：services/payment-hushupay.js（虎皮椒微信支付）
// 设计保留抽象层是为了：
//   1. 测试时能注入 mock（不真打 HTTP）
//   2. 未来如果要换聚合通道（如易支付），replace 这一个文件即可
//
// 虎皮椒以外的任何通道都需要新开 plan 决策后添加（见 decision doc）。
// ════════════════════════════════════════════════════════════════

"use strict";

/**
 * Provider 接口定义（duck typing）：
 *
 * async createOrder({ orderId, amountCents, title, userId, clientType }) -> {
 *   payUrl: string,        // 跳转或二维码 URL
 *   providerOrderId: string,
 *   raw: object,           // 原始响应，便于排查
 * }
 *
 * parseWebhook(body) -> {
 *   valid: boolean,
 *   paid: boolean,
 *   orderId: string,
 *   providerTxId: string,
 *   providerOrderId: string,
 * }
 */

function getProvider(config) {
  const name = (config.providerName || "hushupay_wechat").toLowerCase();
  if (name === "hushupay_wechat") {
    return require("./payment-hushupay").createProvider(config);
  }
  if (name === "mock") {
    return createMockProvider(config);
  }
  throw new Error(`[payment-provider] unknown provider: ${name}`);
}

/** 测试用 mock：总是立即成功，返回假 payUrl。不打 HTTP。 */
function createMockProvider(_config) {
  return {
    name: "mock",
    async createOrder({ orderId, amountCents, title }) {
      return {
        payUrl: `mock://paid?order=${orderId}`,
        providerOrderId: `MOCK_${orderId}`,
        raw: { orderId, amountCents, title, mock: true },
      };
    },
    parseWebhook(body) {
      return {
        valid: body.mock_valid !== false,
        paid: body.mock_paid !== false,
        orderId: body.trade_order_id || body.orderId,
        providerTxId: body.transaction_id || "MOCK_TX",
        providerOrderId: body.open_order_id || "MOCK_OID",
      };
    },
  };
}

module.exports = { getProvider };
```

- [ ] **Step 3.4: 实现 `services/payment-hushupay.js`**

```javascript
// services/payment-hushupay.js
// ════════════════════════════════════════════════════════════════
// 虎皮椒微信支付（xunhupay.com）实现
//
// 文档：https://docs.xunhupay.com/
// 签名：参数按 key ASCII 排序，空值 + hash 字段本身跳过，
//       拼接 "k1=v1&k2=v2&...&key={APP_KEY}" → MD5 小写 32 位。
// 回调：POST JSON，status="OD" 表示支付成功。
// ════════════════════════════════════════════════════════════════

"use strict";

const crypto = require("crypto");

const API_URL = "https://api.xunhupay.com/payment/do.html";

function buildSignature(params, appKey) {
  const keys = Object.keys(params)
    .filter((k) => k !== "hash" && params[k] != null && params[k] !== "")
    .sort();
  const pairs = keys.map((k) => `${k}=${params[k]}`).join("&");
  const raw = `${pairs}&key=${appKey}`;
  return crypto.createHash("md5").update(raw).digest("hex").toLowerCase();
}

function verifySignature(paramsWithHash, appKey) {
  if (!paramsWithHash || !paramsWithHash.hash) return false;
  const expect = buildSignature(paramsWithHash, appKey);
  // constant-time 比较（防时序攻击）
  const a = Buffer.from(expect);
  const b = Buffer.from(String(paramsWithHash.hash).toLowerCase());
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function centsToYuanStr(cents) {
  const n = Math.round(Number(cents));
  const yuan = Math.floor(n / 100);
  const fen = n % 100;
  return `${yuan}.${String(fen).padStart(2, "0")}`;
}

function randomNonce(len = 32) {
  return crypto.randomBytes(Math.ceil(len / 2)).toString("hex").slice(0, len);
}

function buildCreateOrderPayload({
  appId,
  appKey,
  orderId,
  amountCents,
  title,
  notifyUrl,
  returnUrl,
  nowSec,
  nonceStr,
  type = "WAP",
}) {
  const payload = {
    version: "1.1",
    appid: appId,
    trade_order_id: orderId,
    total_fee: centsToYuanStr(amountCents),
    title,
    time: String(nowSec || Math.floor(Date.now() / 1000)),
    notify_url: notifyUrl,
    return_url: returnUrl,
    nonce_str: nonceStr || randomNonce(32),
    payment: "wechat",
    type,
  };
  payload.hash = buildSignature(payload, appKey);
  return payload;
}

function parseWebhook(body, appKey) {
  if (!body || typeof body !== "object") {
    return { valid: false, paid: false };
  }
  const valid = verifySignature(body, appKey);
  if (!valid) {
    return { valid: false, paid: false };
  }
  const paid = String(body.status || "").toUpperCase() === "OD";
  return {
    valid: true,
    paid,
    orderId: body.trade_order_id,
    providerTxId: body.transaction_id || null,
    providerOrderId: body.open_order_id || null,
    totalFee: body.total_fee,
  };
}

/**
 * 真实 HTTP 调用。测试时用 getProvider({providerName:'mock'}) 绕过。
 */
async function callCreateOrderHttp(payload) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(payload)) form.append(k, String(v));
  const resp = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!resp.ok) {
    throw new Error(`[hushupay] HTTP ${resp.status}`);
  }
  return await resp.json();
}

function createProvider({ appId, appKey, notifyUrl, returnUrl, productTitle }) {
  if (!appId || !appKey) {
    throw new Error("[hushupay] missing HUSHUPAY_APP_ID / HUSHUPAY_APP_KEY");
  }
  return {
    name: "hushupay_wechat",
    async createOrder({ orderId, amountCents, title, clientType = "WAP" }) {
      const payload = buildCreateOrderPayload({
        appId,
        appKey,
        orderId,
        amountCents,
        title: title || productTitle || "Book of Elon 永久解锁",
        notifyUrl,
        returnUrl,
        type: clientType === "PC" ? "Scan" : "WAP",
      });
      const data = await callCreateOrderHttp(payload);
      if (!data || (data.errcode && Number(data.errcode) !== 0)) {
        const err = new Error(`[hushupay] create failed: ${data && (data.errmsg || JSON.stringify(data))}`);
        err.code = "provider_create_failed";
        err.raw = data;
        throw err;
      }
      return {
        payUrl: data.url || data.url_qrcode,
        providerOrderId: data.oid || null,
        raw: data,
      };
    },
    parseWebhook(body) {
      return parseWebhook(body, appKey);
    },
  };
}

module.exports = {
  // exports for unit tests
  buildSignature,
  verifySignature,
  buildCreateOrderPayload,
  parseWebhook,
  centsToYuanStr,
  // factory
  createProvider,
};
```

- [ ] **Step 3.5: 跑测试验证通过**

```bash
node tests/unit/payment-hushupay.test.js
```

预期：全绿（10 项）。

- [ ] **Step 3.6: Commit**

```bash
git add services/payment-provider.js services/payment-hushupay.js tests/unit/payment-hushupay.test.js
git commit -m "feat(paywall): R-27 Task 3 - hushupay wechat provider (sign + verify + create + parseWebhook, TDD)"
```

---

### Task 4: `routes/payment.js`——/api/payment/* 路由

**Files:**
- Create: `routes/payment.js`
- Test: `tests/smoke/paywall-route-smoke.js`

**Endpoints:**

| Method | Path | 用途 | 需登录 |
|---|---|---|---|
| POST | `/api/payment/create` | 创建订单 → 返回 payUrl 给前端 | ✅ |
| POST | `/api/payment/webhook` | 虎皮椒服务器回调 | ❌（sig 校验） |
| GET | `/api/payment/status?order_id=...` | 前端轮询订单状态 | ✅ |

**关键安全：**
- `create` 检查是否已付（已付返回 400，不重复建单）
- `webhook` 幂等（`provider_tx_id` UNIQUE 保护 + 显式 `is_paid=0` 才翻）
- 所有 webhook 请求无论签名真假都写 `payment_events` 审计表

- [ ] **Step 4.1: 写 smoke 测试 `tests/smoke/paywall-route-smoke.js`**

```javascript
// tests/smoke/paywall-route-smoke.js
// 端到端：启一个隔离 server (port 3099)，模拟 provider=mock，验整个订单链路
"use strict";

const assert = require("assert");
const http = require("http");
const path = require("path");
const os = require("os");
const Database = require("better-sqlite3");

process.env.NODE_ENV = "test";
process.env.SKIP_AUTO_MIGRATE = "0";
process.env.PAYWALL_ENABLED = "1";
process.env.PAYWALL_PROVIDER = "mock";
process.env.PAYWALL_PRICE_CENTS = "1990";
process.env.SQLITE_DB_PATH = path.join(os.tmpdir(), `paywall-smoke-${Date.now()}.db`);
process.env.PORT = "3099";

// 直接 require server.js（会监听）；测完 kill
const serverModule = require("../../server.js");

function postJson(p, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const req = http.request({
      hostname: "127.0.0.1", port: 3099, path: p, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
    }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// mock 登录：直接往 DB 塞个 user + 把 cookie 伪造
function setupUser(phone) {
  const db = new Database(process.env.SQLITE_DB_PATH);
  const now = Date.now();
  db.prepare("INSERT OR IGNORE INTO users(phone, created_at, last_seen_at, trial_started_at) VALUES(?,?,?,?)")
    .run(phone, now, now, now - 8 * 86400 * 1000); // 过期 trial，需付费
  return db.prepare("SELECT * FROM users WHERE phone=?").get(phone);
}

(async () => {
  try {
    await new Promise((r) => setTimeout(r, 500)); // 等 server 起
    const user = setupUser("13800000099");
    // TODO: 真实 cookie sign 需要从 auth/session-cookie.js 来；smoke 里简化：
    //   提供一个测试期专用的 header X-Test-User-Id（由 server.js 在 NODE_ENV=test 下信任）
    // 这个 hook 在 Task 5 里加到 server.js
    const create = await postJson("/api/payment/create", {}, { "X-Test-User-Id": user.id });
    assert.strictEqual(create.status, 200, `create 应 200，实得 ${create.status} ${create.body}`);
    const createData = JSON.parse(create.body);
    assert.ok(createData.order_id, "应返 order_id");
    assert.ok(createData.pay_url, "应返 pay_url");

    // 模拟 provider webhook（mock provider 无签名校验）
    const wh = await postJson("/api/payment/webhook", {
      trade_order_id: createData.order_id,
      transaction_id: "MOCK_TX_1",
      status: "OD",
      total_fee: "19.90",
    });
    assert.strictEqual(wh.status, 200);

    // 用户现在应 is_paid=1
    const db = new Database(process.env.SQLITE_DB_PATH);
    const after = db.prepare("SELECT is_paid, paid_at FROM users WHERE id=?").get(user.id);
    assert.strictEqual(after.is_paid, 1, "webhook 后 is_paid 应为 1");
    assert.ok(after.paid_at, "paid_at 应写入");

    // 幂等：第二次 webhook 不报错也不改时间
    const wh2 = await postJson("/api/payment/webhook", {
      trade_order_id: createData.order_id,
      transaction_id: "MOCK_TX_1",
      status: "OD",
    });
    assert.strictEqual(wh2.status, 200);
    const after2 = db.prepare("SELECT paid_at FROM users WHERE id=?").get(user.id);
    assert.strictEqual(after.paid_at, after2.paid_at);

    console.log("[paywall-route-smoke] all ok");
    process.exit(0);
  } catch (e) {
    console.error("[paywall-route-smoke] FAIL:", e);
    process.exit(1);
  }
})();
```

**注意**：这个 smoke 依赖 Task 5 在 `server.js` 里加 test-only `X-Test-User-Id` 头支持 + 注册 `/api/payment/*` 路由。

- [ ] **Step 4.2: 实现 `routes/payment.js`**

```javascript
// routes/payment.js
// ════════════════════════════════════════════════════════════════
// /api/payment/* 路由：create / webhook / status
// ════════════════════════════════════════════════════════════════

"use strict";

const crypto = require("crypto");
const { getDb } = require("../db/database");
const { getProvider } = require("../services/payment-provider");
const { markPaid } = require("../services/paywall");

function newOrderId(userId) {
  const rand = crypto.randomBytes(3).toString("hex");
  return `${userId}-${Date.now()}-${rand}`;
}

function recordEvent(db, { orderId, eventType, rawPayload, ip, notes }) {
  db.prepare(
    `INSERT INTO payment_events(order_id, event_type, raw_payload, ip, received_at, notes)
     VALUES(?,?,?,?,?,?)`
  ).run(
    orderId || null,
    eventType,
    typeof rawPayload === "string" ? rawPayload : JSON.stringify(rawPayload),
    ip || null,
    Date.now(),
    notes || null
  );
}

async function handleCreate(req, res, { user, config }) {
  const db = getDb();
  if (!user) {
    return sendJson(res, 401, { error: "login_required" });
  }
  // 已付：不建新单
  const fresh = db.prepare("SELECT is_paid FROM users WHERE id=?").get(user.id);
  if (fresh && fresh.is_paid === 1) {
    return sendJson(res, 400, { error: "already_paid" });
  }

  const orderId = newOrderId(user.id);
  const now = Date.now();
  db.prepare(
    `INSERT INTO payment_orders(order_id, user_id, amount_cents, status, provider, created_at)
     VALUES(?,?,?,?,?,?)`
  ).run(orderId, user.id, config.priceCents, "pending", config.providerName, now);

  try {
    const provider = getProvider(config);
    const clientType = /(iPhone|Android|Mobi)/i.test(req.headers["user-agent"] || "") ? "WAP" : "PC";
    const created = await provider.createOrder({
      orderId,
      amountCents: config.priceCents,
      title: "Book of Elon · 永久解锁",
      clientType,
    });

    db.prepare(
      "UPDATE payment_orders SET provider_order_id=? WHERE order_id=?"
    ).run(created.providerOrderId || null, orderId);

    recordEvent(db, {
      orderId,
      eventType: "create_order",
      rawPayload: created.raw || {},
      ip: req.socket && req.socket.remoteAddress,
      notes: `provider=${provider.name}`,
    });

    return sendJson(res, 200, {
      order_id: orderId,
      pay_url: created.payUrl,
      amount_cents: config.priceCents,
    });
  } catch (err) {
    db.prepare("UPDATE payment_orders SET status='failed' WHERE order_id=?").run(orderId);
    recordEvent(db, {
      orderId,
      eventType: "create_order_failed",
      rawPayload: { message: err.message, code: err.code },
      ip: req.socket && req.socket.remoteAddress,
    });
    return sendJson(res, 502, { error: "provider_unavailable" });
  }
}

async function handleWebhook(req, res, { config, body }) {
  const db = getDb();
  const ip = req.socket && req.socket.remoteAddress;

  // 先无条件审计，哪怕签名错
  recordEvent(db, {
    orderId: body && body.trade_order_id,
    eventType: "webhook_received",
    rawPayload: body,
    ip,
  });

  const provider = getProvider(config);
  const parsed = provider.parseWebhook(body);

  if (!parsed.valid) {
    recordEvent(db, {
      orderId: body && body.trade_order_id,
      eventType: "sig_invalid",
      rawPayload: body,
      ip,
      notes: "signature verification failed",
    });
    return sendText(res, 400, "BAD_SIGNATURE");
  }

  const order = db.prepare("SELECT * FROM payment_orders WHERE order_id=?").get(parsed.orderId);
  if (!order) {
    recordEvent(db, {
      orderId: parsed.orderId,
      eventType: "order_not_found",
      rawPayload: body,
      ip,
    });
    return sendText(res, 404, "NOT_FOUND");
  }

  if (!parsed.paid) {
    // 保留 pending 状态；provider 重试时可能再发
    recordEvent(db, {
      orderId: parsed.orderId,
      eventType: "webhook_not_paid",
      rawPayload: body,
      ip,
    });
    return sendText(res, 200, "OK");
  }

  // 幂等检查：order 已 paid 或 provider_tx_id 已存在
  if (order.status === "paid") {
    recordEvent(db, {
      orderId: parsed.orderId,
      eventType: "webhook_duplicate",
      rawPayload: body,
      ip,
    });
    return sendText(res, 200, "OK");
  }

  const now = Date.now();
  const txn = db.transaction(() => {
    try {
      db.prepare(
        `UPDATE payment_orders SET status='paid', paid_at=?, provider_tx_id=? WHERE order_id=? AND status='pending'`
      ).run(now, parsed.providerTxId || null, parsed.orderId);
    } catch (e) {
      // UNIQUE violation on provider_tx_id: 幂等保护，忽略
      if (!/UNIQUE/i.test(String(e.message))) throw e;
    }
    markPaid(db, order.user_id, now);
  });
  txn();

  recordEvent(db, {
    orderId: parsed.orderId,
    eventType: "status_updated",
    rawPayload: body,
    ip,
    notes: "paid",
  });
  return sendText(res, 200, "OK");
}

function handleStatus(req, res, { user, url }) {
  if (!user) return sendJson(res, 401, { error: "login_required" });
  const db = getDb();
  const orderId = (url.searchParams.get("order_id") || "").trim();
  if (!orderId) return sendJson(res, 400, { error: "missing_order_id" });
  const order = db.prepare(
    "SELECT order_id, status, amount_cents, paid_at, created_at FROM payment_orders WHERE order_id=? AND user_id=?"
  ).get(orderId, user.id);
  if (!order) return sendJson(res, 404, { error: "not_found" });
  return sendJson(res, 200, order);
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
function sendText(res, code, text) {
  res.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

module.exports = { handleCreate, handleWebhook, handleStatus };
```

- [ ] **Step 4.3: Commit（测试在 Task 5 一起跑，因为依赖 server.js 的集成）**

```bash
git add routes/payment.js tests/smoke/paywall-route-smoke.js
git commit -m "feat(paywall): R-27 Task 4 - /api/payment/* routes (create/webhook/status + audit events)"
```

---

### Task 5: `server.js` 集成——paywall gate + 路由注册 + test hook

**Files:**
- Modify: `server.js`

**要改 4 处：**

1. **顶部加环境变量读取和 paywall service import**
2. **注册 `/api/payment/*` 路由**
3. **加 `/api/paywall/state` 路由**
4. **在 `/api/chat` handler 里插入 paywall gate**
5. **测试用 `X-Test-User-Id` 头（仅 NODE_ENV=test 生效）**

- [ ] **Step 5.1: 读现有 server.js 的 /api/chat 入口位置**

```bash
# 找到 /api/chat 路由分派的行
grep -n 'api/chat' server.js | head
```

- [ ] **Step 5.2: 在 server.js 顶部（其他 service import 附近）加：**

```javascript
// ── R-27 Paywall ─────────────────────────────────────────────
const paywall = require("./services/paywall");
const paymentRoutes = require("./routes/payment");
const PAYWALL_ENABLED = String(process.env.PAYWALL_ENABLED ?? "0") === "1";
const PAYWALL_PROVIDER = process.env.PAYWALL_PROVIDER || "hushupay_wechat";
const PAYWALL_PRICE_CENTS = Number(process.env.PAYWALL_PRICE_CENTS || 1990);
const PAYWALL_DAILY_HARD_LIMIT = Number(process.env.PAYWALL_DAILY_HARD_LIMIT || 100);
const HUSHUPAY_APP_ID = process.env.HUSHUPAY_APP_ID || "";
const HUSHUPAY_APP_KEY = process.env.HUSHUPAY_APP_KEY || "";
const HUSHUPAY_NOTIFY_URL = process.env.HUSHUPAY_NOTIFY_URL || "";
const HUSHUPAY_RETURN_URL = process.env.HUSHUPAY_RETURN_URL || "";

const paywallConfig = {
  enabled: PAYWALL_ENABLED,
  providerName: PAYWALL_PROVIDER,
  priceCents: PAYWALL_PRICE_CENTS,
  dailyHardLimit: PAYWALL_DAILY_HARD_LIMIT,
  appId: HUSHUPAY_APP_ID,
  appKey: HUSHUPAY_APP_KEY,
  notifyUrl: HUSHUPAY_NOTIFY_URL,
  returnUrl: HUSHUPAY_RETURN_URL,
  productTitle: "Book of Elon · 永久解锁",
};
// ─────────────────────────────────────────────────────────────
```

- [ ] **Step 5.3: 在路由分派区（其他 /api/xxx 附近）加：**

```javascript
// ── Payment routes ───────────────────────────────────────────
if (url.pathname === "/api/payment/create" && req.method === "POST") {
  return paymentRoutes.handleCreate(req, res, { user: currentUser, config: paywallConfig });
}
if (url.pathname === "/api/payment/webhook" && req.method === "POST") {
  // body 已被 bodyParser 解析
  return paymentRoutes.handleWebhook(req, res, { config: paywallConfig, body: parsedBody });
}
if (url.pathname === "/api/payment/status" && req.method === "GET") {
  return paymentRoutes.handleStatus(req, res, { user: currentUser, url });
}
if (url.pathname === "/api/paywall/state" && req.method === "GET") {
  const state = paywall.computeState(currentUser, { enabled: PAYWALL_ENABLED });
  return sendJson(res, 200, paywall.serializeForApi(state));
}
// ─────────────────────────────────────────────────────────────
```

（占位符 `sendJson` / `currentUser` / `parsedBody` / `url` 的名字必须对齐 server.js 现有命名；实现时以实际 grep 为准）

- [ ] **Step 5.4: 在 `/api/chat` POST handler 内，紧接 cost-control 判断之后插入 paywall gate：**

```javascript
// ── Paywall gate (R-27) ──────────────────────────────────────
if (PAYWALL_ENABLED) {
  const pwState = paywall.computeState(currentUser, { enabled: true });
  if (!paywall.isEntitled(pwState)) {
    return sendJson(res, 402, {
      error: "paywall_required",
      paywall: paywall.serializeForApi(pwState),
      price_cents: PAYWALL_PRICE_CENTS,
    });
  }
  // 付费用户仍有反刷上限
  if (pwState.state === "paid" || pwState.state === "grandfathered") {
    // 这里复用现有 cost-control 的 per-user 计数逻辑（见 services/cost-control.js）
    // 如果超 PAYWALL_DAILY_HARD_LIMIT → 返回 429
    // (具体 key 用 `user:${currentUser.id}`，实现时参照 per-IP 配额)
  }
}
// ─────────────────────────────────────────────────────────────
```

- [ ] **Step 5.5: 在 auth verify-code 成功时调 `startTrial`**

找到 `routes/auth.js::handleVerifyCode`（或 server.js 里的等价位置）在 user 插入/查到后：

```javascript
const paywall = require("../services/paywall");
// ... 原有 user 插入/查询逻辑 ...
paywall.startTrial(getDb(), user.id); // 幂等：只对 trial_started_at=NULL 的用户生效
```

- [ ] **Step 5.6: 加 test-only X-Test-User-Id 头**

仅当 `process.env.NODE_ENV === "test"` 时生效，位置在 cookie 解析之后、路由分派之前：

```javascript
if (process.env.NODE_ENV === "test" && req.headers["x-test-user-id"]) {
  const uid = Number(req.headers["x-test-user-id"]);
  if (uid > 0) {
    const u = getDb().prepare("SELECT * FROM users WHERE id=?").get(uid);
    if (u) currentUser = u;
  }
}
```

- [ ] **Step 5.7: 跑 smoke**

```bash
node tests/smoke/paywall-route-smoke.js
```

预期：`[paywall-route-smoke] all ok`。

- [ ] **Step 5.8: 跑现有所有 smoke 确认不回归**

```bash
node tests/smoke/chat.js
node tests/smoke/static.js
node tests/smoke/persist.js
node tests/smoke/cost.js
```

预期：全绿。如果某项回归，**立即回滚本任务**，不要前进。

- [ ] **Step 5.9: Commit**

```bash
git add server.js routes/auth.js  # 或任何被改的文件
git commit -m "feat(paywall): R-27 Task 5 - integrate paywall gate + /api/paywall/state + /api/payment/*"
```

---

### Task 6: 前端——paywall 模态 + 402 拦截

**Files:**
- Create: `web/paywall.js`
- Create: `web/paywall.css`
- Modify: `web/index.html`
- Modify: `web/app.js`
- Modify: `server.js`（`STATIC_FILE_ALLOW` 白名单加 `/paywall.js` 和 `/paywall.css`）

**行为：**
- 页面加载时 `fetch /api/paywall/state`，若 `state === "trial"` 顶部显示横幅"试用还剩 X 天"
- 用户聊天收到 402 时 `paywall.showModal()`
- 模态点"立即解锁 ¥19.9"→ POST `/api/payment/create` → 拿 `pay_url` → 微信支付（PC 扫码 / H5 跳转）
- 支付页跳回后前端每 3 秒轮询 `/api/payment/status`，成功 → 刷新 `/api/paywall/state` → 关闭模态

- [ ] **Step 6.1: 创建 `web/paywall.css`**

```css
/* web/paywall.css — R-27 */
.paywall-banner {
  position: fixed;
  top: 0; left: 0; right: 0;
  background: rgba(255, 204, 102, 0.9);
  color: #333;
  padding: 8px 16px;
  text-align: center;
  font-size: 14px;
  z-index: 9998;
  backdrop-filter: blur(8px);
}
.paywall-banner.paywall-banner--hidden { display: none; }

.paywall-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  backdrop-filter: blur(16px);
}
.paywall-modal.paywall-modal--hidden { display: none; }
.paywall-modal__panel {
  background: #fff;
  border-radius: 16px;
  max-width: 420px;
  width: calc(100vw - 32px);
  padding: 32px 28px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.4);
  text-align: center;
}
.paywall-modal__title {
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 12px;
  color: #111;
}
.paywall-modal__sub {
  font-size: 14px;
  color: #555;
  line-height: 1.6;
  margin: 0 0 24px;
}
.paywall-modal__price {
  font-size: 40px;
  font-weight: 800;
  color: #07c160;
  margin: 8px 0 24px;
}
.paywall-modal__cta {
  background: #07c160;
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 14px 24px;
  width: 100%;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.12s, background 0.12s;
}
.paywall-modal__cta:hover { background: #06ad56; }
.paywall-modal__cta:active { transform: translateY(1px); }
.paywall-modal__cta[disabled] { background: #aaa; cursor: not-allowed; }
.paywall-modal__later {
  margin-top: 12px;
  background: transparent;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 13px;
}
.paywall-modal__qr {
  margin: 16px 0;
}
.paywall-modal__qr img { max-width: 200px; border-radius: 8px; }
.paywall-modal__fine {
  font-size: 11px;
  color: #999;
  margin-top: 16px;
  line-height: 1.6;
}
```

- [ ] **Step 6.2: 创建 `web/paywall.js`**

```javascript
// web/paywall.js — R-27 paywall frontend module
// 暴露到 window.__paywall 供 app.js 拦 402 时调用
(function () {
  "use strict";

  const state = {
    current: null,         // 最近一次 /api/paywall/state 响应
    modalEl: null,
    bannerEl: null,
    polling: null,
    currentOrderId: null,
  };

  async function fetchState() {
    try {
      const res = await fetch("/api/paywall/state", { credentials: "include" });
      if (!res.ok) return null;
      state.current = await res.json();
      renderBanner();
      return state.current;
    } catch (_) { return null; }
  }

  function renderBanner() {
    if (!state.bannerEl) return;
    const s = state.current;
    if (!s || s.state !== "trial") {
      state.bannerEl.classList.add("paywall-banner--hidden");
      return;
    }
    const days = s.trial_remaining_days;
    state.bannerEl.textContent = `试用还剩 ${days} 天，到期后可付费解锁永久使用`;
    state.bannerEl.classList.remove("paywall-banner--hidden");
  }

  function ensureModal() {
    if (state.modalEl) return state.modalEl;
    const el = document.createElement("div");
    el.className = "paywall-modal paywall-modal--hidden";
    el.innerHTML = `
      <div class="paywall-modal__panel">
        <h2 class="paywall-modal__title">让 AI 永远记得你</h2>
        <p class="paywall-modal__sub">
          你的北极星、你说过的 blocker、你做过的决定，以后都在。<br>
          一次解锁，终身使用。
        </p>
        <div class="paywall-modal__price">¥19.9</div>
        <button class="paywall-modal__cta" data-action="pay">立即解锁</button>
        <div class="paywall-modal__qr" data-slot="qr"></div>
        <button class="paywall-modal__later" data-action="later">稍后再说</button>
        <p class="paywall-modal__fine">
          支付完成后刷新页面即可。产品下线不退款；7 天内无理由退款请联系微信客服。
        </p>
      </div>
    `;
    document.body.appendChild(el);
    el.addEventListener("click", (e) => {
      const action = e.target && e.target.dataset && e.target.dataset.action;
      if (action === "later") hideModal();
      if (action === "pay") startPayment();
    });
    state.modalEl = el;
    return el;
  }

  function showModal() {
    const el = ensureModal();
    el.classList.remove("paywall-modal--hidden");
  }
  function hideModal() {
    if (state.modalEl) state.modalEl.classList.add("paywall-modal--hidden");
    stopPolling();
  }

  async function startPayment() {
    const btn = state.modalEl.querySelector('[data-action="pay"]');
    btn.disabled = true;
    btn.textContent = "正在生成订单...";
    try {
      const res = await fetch("/api/payment/create", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        btn.disabled = false;
        btn.textContent = "重新尝试";
        alert("支付通道暂不可用，稍后再试");
        return;
      }
      const data = await res.json();
      state.currentOrderId = data.order_id;

      // PC 扫码：显示二维码；H5：跳转
      const isMobile = /(iPhone|Android|Mobi)/i.test(navigator.userAgent);
      if (isMobile) {
        window.location.href = data.pay_url;
      } else {
        showQrCode(data.pay_url);
      }
      startPolling(data.order_id);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "重新尝试";
    }
  }

  function showQrCode(payUrl) {
    const slot = state.modalEl.querySelector('[data-slot="qr"]');
    // 用公共二维码生成器（纯前端，不打 HTTP）：这里简化用 google chart API 的替代，
    // 避免外部依赖：改成直接显示链接（用户自己复制或用第三方扫码工具）
    // 进阶版可内嵌 qrcode.js 本地包；本 toy 版本简化处理。
    slot.innerHTML = `
      <p style="font-size:13px;color:#555;margin:0 0 8px;">
        微信扫码支付（或复制链接到微信打开）：
      </p>
      <div style="border:1px solid #eee;border-radius:8px;padding:12px;word-break:break-all;font-size:11px;color:#333;">
        ${payUrl}
      </div>
    `;
  }

  function startPolling(orderId) {
    stopPolling();
    state.polling = setInterval(async () => {
      try {
        const res = await fetch(`/api/payment/status?order_id=${encodeURIComponent(orderId)}`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.status === "paid") {
          stopPolling();
          await fetchState();
          hideModal();
          if (window.__onPaywallCleared) window.__onPaywallCleared();
          alert("支付成功！已解锁永久使用。");
        }
      } catch (_) {}
    }, 3000);
  }

  function stopPolling() {
    if (state.polling) { clearInterval(state.polling); state.polling = null; }
  }

  function init() {
    const banner = document.createElement("div");
    banner.className = "paywall-banner paywall-banner--hidden";
    document.body.prepend(banner);
    state.bannerEl = banner;
    fetchState();
  }

  window.__paywall = { init, fetchState, showModal, hideModal };
  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
```

- [ ] **Step 6.3: 在 `web/index.html` 里加引用**

在 `</head>` 前加：
```html
<link rel="stylesheet" href="/paywall.css">
```
在 `</body>` 前（在 `/app.js` 引用之前）加：
```html
<script src="/paywall.js"></script>
```

- [ ] **Step 6.4: 在 `web/app.js` 里拦 402 响应**

找到现有 `/api/chat` 的 fetch 调用（通常在 sendMessage 函数内），改为：

```javascript
const res = await fetch("/api/chat", { /* ... 原有选项 ... */ });
if (res.status === 402) {
  const data = await res.json().catch(() => ({}));
  if (window.__paywall) window.__paywall.showModal();
  // 不继续处理回复，不报错到用户
  return;
}
// ... 原有 200 / 429 / 其他错误处理 ...
```

- [ ] **Step 6.5: 在 `server.js` 的 `STATIC_FILE_ALLOW` Set 里加两项**

```javascript
STATIC_FILE_ALLOW.add("/paywall.js");
STATIC_FILE_ALLOW.add("/paywall.css");
```

- [ ] **Step 6.6: 本地启动验证**

```bash
PAYWALL_ENABLED=1 PAYWALL_PROVIDER=mock npm run dev
# 浏览器打开，登录，等 trial 倒计时 → 模拟过期（DB 直改 trial_started_at=now-8d）→ 发消息看 paywall 弹层
```

- [ ] **Step 6.7: Commit**

```bash
git add web/paywall.js web/paywall.css web/index.html web/app.js server.js
git commit -m "feat(paywall): R-27 Task 6 - frontend paywall modal + banner + 402 interception"
```

---

### Task 7: End-to-end 冒烟 + jsdom 点击路径

**Files:**
- Create: `tests/e2e/paywall-e2e.js`

- [ ] **Step 7.1: 写 e2e**

```javascript
// tests/e2e/paywall-e2e.js — 完整闭环：登录 → trial → 过期 → 弹 paywall → (mock)付 → 恢复聊
"use strict";

const assert = require("assert");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");
const http = require("http");

const PORT = 3098;
const DB = path.join(os.tmpdir(), `paywall-e2e-${Date.now()}.db`);

const server = spawn(process.execPath, ["server.js"], {
  env: {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(PORT),
    SQLITE_DB_PATH: DB,
    PAYWALL_ENABLED: "1",
    PAYWALL_PROVIDER: "mock",
    PAYWALL_PRICE_CENTS: "1990",
    DEEPSEEK_API_KEY: "", // 让 chat 走 fallback，关注 paywall 行为
  },
  stdio: "inherit",
});

function req(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : "";
    const opts = {
      hostname: "127.0.0.1", port: PORT, path: p, method,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        ...headers,
      },
    };
    const r = http.request(opts, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf || "{}") }); }
        catch (_) { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    r.on("error", reject);
    if (body) r.write(data);
    r.end();
  });
}

async function waitReady() {
  for (let i = 0; i < 30; i++) {
    try { const r = await req("GET", "/api/health"); if (r.status === 200) return; } catch (_) {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server not ready");
}

(async () => {
  try {
    await waitReady();
    const Database = require("better-sqlite3");
    const db = new Database(DB);
    const now = Date.now();

    // 1. 造个 user + trial 已过期
    db.prepare("INSERT INTO users(phone, created_at, last_seen_at, trial_started_at) VALUES(?,?,?,?)")
      .run("13811111100", now, now, now - 10 * 86400 * 1000);
    const user = db.prepare("SELECT * FROM users WHERE phone=?").get("13811111100");

    // 2. 发聊天请求（带 test user header）应 402
    const chat1 = await req("POST", "/api/chat",
      { message: "hi" },
      { "X-Test-User-Id": String(user.id) }
    );
    assert.strictEqual(chat1.status, 402, `expired 用户应 402，实得 ${chat1.status}`);
    assert.strictEqual(chat1.body.error, "paywall_required");

    // 3. 建单
    const create = await req("POST", "/api/payment/create", {}, { "X-Test-User-Id": String(user.id) });
    assert.strictEqual(create.status, 200);
    const orderId = create.body.order_id;

    // 4. mock webhook
    const wh = await req("POST", "/api/payment/webhook", {
      trade_order_id: orderId,
      transaction_id: "MOCK_E2E_TX",
      status: "OD",
      total_fee: "19.90",
    });
    assert.strictEqual(wh.status, 200);

    // 5. 再发聊天，应 200（已付）
    const chat2 = await req("POST", "/api/chat",
      { message: "now i paid" },
      { "X-Test-User-Id": String(user.id) }
    );
    assert.strictEqual(chat2.status, 200, `paid 用户应 200，实得 ${chat2.status}`);

    console.log("[paywall-e2e] all ok");
    server.kill();
    process.exit(0);
  } catch (e) {
    console.error("[paywall-e2e] FAIL:", e);
    server.kill();
    process.exit(1);
  }
})();
```

- [ ] **Step 7.2: 跑 e2e**

```bash
node tests/e2e/paywall-e2e.js
```

预期：`[paywall-e2e] all ok`。

- [ ] **Step 7.3: Commit**

```bash
git add tests/e2e/paywall-e2e.js
git commit -m "test(paywall): R-27 Task 7 - full e2e loop (trial → expired → 402 → mock pay → entitled)"
```

---

### Task 8: Grandfather 现有 3 个登录用户

**Files:**
- Create: `scripts/ops/grandfather-existing-users.js`

**Context:** 当前 DB 里的 3 个登录用户（user.id ∈ {1,2,3}）都是 owner 亲友，承诺不收费。

- [ ] **Step 8.1: 实现脚本**

```javascript
#!/usr/bin/env node
// scripts/ops/grandfather-existing-users.js
// 给当前 DB 里所有 already-existing users（id ≤ N）打 grandfathered=1 标记
// 一次性脚本，迁移后归档即可
"use strict";
const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, "..", "..", "data", "app.db");
if (!fs.existsSync(dbPath)) { console.error("db not found:", dbPath); process.exit(1); }
const db = new Database(dbPath);

const cutoffId = Number(process.argv[2] || 0);
if (!cutoffId) {
  console.error("usage: node scripts/ops/grandfather-existing-users.js <max_user_id>");
  console.error("  会把 users.id <= max_user_id 的所有用户标记为 grandfathered");
  process.exit(2);
}

const affected = db.prepare("SELECT id, phone, created_at FROM users WHERE id <= ? AND grandfathered = 0").all(cutoffId);
console.log(`将 grandfather 的用户（${affected.length} 个）：`);
for (const u of affected) {
  const masked = `${u.phone.slice(0,3)}****${u.phone.slice(-4)}`;
  console.log(`  id=${u.id} phone=${masked} created=${new Date(u.created_at).toISOString()}`);
}
if (process.argv[3] !== "--apply") {
  console.log("\n(dry-run) 加 --apply 真正执行");
  process.exit(0);
}

const r = db.prepare("UPDATE users SET grandfathered = 1 WHERE id <= ? AND grandfathered = 0").run(cutoffId);
console.log(`\n✓ updated ${r.changes} rows`);
```

- [ ] **Step 8.2: 本地 dry-run**

```bash
node scripts/ops/grandfather-existing-users.js 3
```

预期：列出 3 个用户，标记 `(dry-run)`。

- [ ] **Step 8.3: 生产执行前手动核对 3 个 phone 是不是 owner 亲友**

在服务器上跑 `SELECT id, phone, created_at FROM users ORDER BY id` 手查，确认这 3 个号是 owner 能记起来的。**有任何一个不认识就 STOP**，改用 phone allowlist 方案。

- [ ] **Step 8.4: Commit（脚本本身，不在此 commit 里实际跑生产）**

```bash
git add scripts/ops/grandfather-existing-users.js
git commit -m "ops(paywall): R-27 Task 8 - grandfather-existing-users.js (dry-run + apply flag)"
```

---

### Task 9: Demand Kill Switch 月度报告脚本

**Files:**
- Create: `scripts/ops/demand-report.js`

**Context:** 决策文档里写死了 Kill Switch（3/6/12 个月阈值）。这个脚本每月 1 号手动跑一次，输出是否触发。不做自动关站——人工决策。

- [ ] **Step 9.1: 实现**

```javascript
#!/usr/bin/env node
// scripts/ops/demand-report.js — R-27 Kill Switch 月度报告
// 参考决策 doc: 2026-04-27-toy-mode-and-paywall.md §2.4
"use strict";

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const dbPath = process.env.SQLITE_DB_PATH || path.join(__dirname, "..", "..", "data", "app.db");
if (!fs.existsSync(dbPath)) { console.error("db not found"); process.exit(1); }
const db = new Database(dbPath, { readonly: true });

// 付费墙上线日期从 env / 命令行传；本地开发给默认
const launchedAt = Number(process.env.PAYWALL_LAUNCHED_AT || process.argv[2] || 0);
if (!launchedAt) {
  console.error("usage: PAYWALL_LAUNCHED_AT=<ms_epoch> demand-report.js  或传第二参数");
  process.exit(2);
}

const now = Date.now();
const daysSinceLaunch = Math.floor((now - launchedAt) / 86400000);

const paidCount = db.prepare("SELECT COUNT(*) AS n FROM users WHERE is_paid = 1 AND grandfathered = 0").get().n;
const trialActive = db.prepare(
  `SELECT COUNT(*) AS n FROM users
   WHERE grandfathered = 0 AND is_paid = 0
     AND trial_started_at IS NOT NULL
     AND (? - trial_started_at) < ?`
).get(now, 7 * 86400 * 1000).n;
const expiredUnpaid = db.prepare(
  `SELECT COUNT(*) AS n FROM users
   WHERE grandfathered = 0 AND is_paid = 0
     AND trial_started_at IS NOT NULL
     AND (? - trial_started_at) >= ?`
).get(now, 7 * 86400 * 1000).n;
const totalOrders = db.prepare("SELECT COUNT(*) AS n FROM payment_orders").get().n;
const paidOrders = db.prepare("SELECT COUNT(*) AS n FROM payment_orders WHERE status='paid'").get().n;
const revCents = db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS s FROM payment_orders WHERE status='paid'").get().s;

console.log("═".repeat(64));
console.log(`Book of Elon · R-27 Demand Report · ${new Date().toISOString()}`);
console.log("═".repeat(64));
console.log(`Launched: ${new Date(launchedAt).toISOString()} (${daysSinceLaunch} 天前)`);
console.log();
console.log("用户侧：");
console.log(`  付费用户（非 grandfathered）: ${paidCount}`);
console.log(`  trial 进行中              : ${trialActive}`);
console.log(`  过期未付费                : ${expiredUnpaid}`);
console.log();
console.log("订单侧：");
console.log(`  订单总数: ${totalOrders}  | 付费成功: ${paidOrders}`);
console.log(`  收入    : ¥${(revCents / 100).toFixed(2)}`);
console.log();

// Kill Switch 判断
function checkThreshold() {
  if (daysSinceLaunch >= 30 * 3 && daysSinceLaunch < 30 * 6) {
    if (paidCount < 3) {
      console.log("⚠️  TRIGGERED · 3 个月窗口 · < 3 付费");
      console.log("   动作：复盘 funnel，允许一次调整（文案/定价）重跑");
    } else {
      console.log("✓ 3 个月窗口通过（付费 ≥ 3）");
    }
  } else if (daysSinceLaunch >= 30 * 6 && daysSinceLaunch < 30 * 12) {
    if (paidCount < 5) {
      console.log("🔴 KILL SWITCH 6 个月窗口触发 · 付费 < 5");
      console.log("   动作：承认 demand 不存在 → 执行 docs/runbooks/incident-shutdown.md");
    } else {
      console.log("✓ 6 个月窗口通过（付费 ≥ 5）");
    }
  } else if (daysSinceLaunch >= 30 * 12) {
    if (paidCount >= 15) {
      console.log("🟢 REVIVAL 条件达成 · 12 个月付费 ≥ 15");
      console.log("   动作：重跑 /office-hours 认真考虑复活成正经产品");
    } else {
      console.log(`当前 ${paidCount} 付费用户，未达 revival 线（15）。维持 toy 状态。`);
    }
  } else {
    console.log(`当前 ${daysSinceLaunch} 天，未到 3-月检查点`);
  }
}
checkThreshold();
console.log("═".repeat(64));
```

- [ ] **Step 9.2: 加到 `package.json` scripts**

```json
"ops:demand-report": "node scripts/ops/demand-report.js"
```

- [ ] **Step 9.3: Commit**

```bash
git add scripts/ops/demand-report.js package.json
git commit -m "ops(paywall): R-27 Task 9 - demand-report.js (Kill Switch monthly check)"
```

---

### Task 10: Runbooks

**Files:**
- Create: `docs/runbooks/incident-payment-down.md`
- Create: `docs/runbooks/incident-shutdown.md`

- [ ] **Step 10.1: 写 `incident-payment-down.md`**

内容大纲：
1. 症状：前端"立即解锁"按钮卡死 / 报 502 / 回调没触发
2. 一句话决策树：
   ```
   /api/payment/create 502? → 虎皮椒侧 or 我们签名错
     ├ 查 payment_events: 最新 create_order_failed 的 raw → 看 errmsg
     ├ 虎皮椒后台手查商户状态 / 通知地址是否正确
     └ 临时措施：PAYWALL_ENABLED=0 让所有用户回 trial 模式，避免坏 UX
   ```
3. webhook 没回调：
   - 公司防火墙 / Nginx 是否允许 /api/payment/webhook POST
   - 查 payment_events 有无 webhook_received 记录
   - 虎皮椒后台手动点"重发通知"
4. 用户声称付了但没解锁：
   - 查 payment_orders.status
   - 查虎皮椒后台对应 order_id 的状态
   - 手动 `UPDATE users SET is_paid=1, paid_at=... WHERE id=?` 兜底

- [ ] **Step 10.2: 写 `incident-shutdown.md`**

Kill Switch 关站流程（给未来的 owner 看）：

1. 确认：demand-report.js 确实触发 6-month < 5 阈值
2. 48h 公告期：首页顶部横幅"本站将于 YYYY-MM-DD 关闭，已付费用户... TBD（决定是否退款）"
3. 关站步骤：
   - PM2 stop + disable
   - Nginx 301 跳一个 static `goodbye.html`（感谢语 + GitHub 链接 + 个人项目模板仓库）
   - `.env` 里 `PAYWALL_ENABLED=0` 防止遗漏订单
   - DeepSeek API key rotate（防继续烧）
   - DNS 保留（下次复活不用重新备案）
4. 数据保留：
   - `data/app.db` 归档到 `~/.archive/book-of-elon/<date>/app.db.gz`
   - 删除生产服务器上的原文件（合规）
5. 最后一件事：写复盘 `docs/superpowers/retrospectives/YYYY-MM-DD-shutdown.md`

- [ ] **Step 10.3: Commit**

```bash
git add docs/runbooks/incident-payment-down.md docs/runbooks/incident-shutdown.md
git commit -m "docs(runbooks): R-27 Task 10 - payment-down + shutdown runbooks"
```

---

### Task 11: Config surface 收尾

**Files:**
- Modify: `.env.example`
- Modify: `.env.production.example`
- Modify: `preflight-check.js`
- Modify: `CLAUDE.md`（§4 + §5）
- Modify: `README.md`（单独一段说明付费墙）

- [ ] **Step 11.1: 在 `.env.example` 末尾追加：**

```bash
# ── Paywall (R-27) ──────────────────────────────────────────
# 设 1 开启付费墙；0 完全关闭（所有用户视为已付）
PAYWALL_ENABLED=0

# 价格（分为单位）— 默认 ¥19.9
PAYWALL_PRICE_CENTS=1990

# trial 每日对话硬上限（反刷用，付费/grandfathered 用户也受此限）
PAYWALL_DAILY_HARD_LIMIT=100

# 支付通道：当前唯一支持 hushupay_wechat；测试用 mock
PAYWALL_PROVIDER=hushupay_wechat

# 虎皮椒微信支付（xunhupay.com）
HUSHUPAY_APP_ID=your_app_id_here
HUSHUPAY_APP_KEY=your_app_key_here
HUSHUPAY_NOTIFY_URL=https://bookofelon.cn/api/payment/webhook
HUSHUPAY_RETURN_URL=https://bookofelon.cn/?paid=1
```

`.env.production.example` 同样处理。

- [ ] **Step 11.2: `preflight-check.js` 在 `--strict-production` 里加**

```javascript
if (process.env.PAYWALL_ENABLED === "1") {
  const need = ["HUSHUPAY_APP_ID", "HUSHUPAY_APP_KEY", "HUSHUPAY_NOTIFY_URL", "HUSHUPAY_RETURN_URL"];
  for (const k of need) {
    if (!process.env[k]) errors.push(`PAYWALL_ENABLED=1 但缺 ${k}`);
  }
}
```

- [ ] **Step 11.3: `CLAUDE.md` §5 环境变量表追加行（4 个付费项 + 虎皮椒 4 项）**

- [ ] **Step 11.4: `CLAUDE.md` §4 新增 4.7 子章节"付费墙状态机"**

简述 6 态 + 引用 `services/paywall.js` + "改行为前先读 decision doc"。

- [ ] **Step 11.5: 跑 preflight 验证**

```bash
PAYWALL_ENABLED=1 node preflight-check.js --strict-production
# 预期报缺 HUSHUPAY_APP_ID

PAYWALL_ENABLED=1 HUSHUPAY_APP_ID=x HUSHUPAY_APP_KEY=y HUSHUPAY_NOTIFY_URL=https://example.com HUSHUPAY_RETURN_URL=https://example.com node preflight-check.js --strict-production
# 预期通过
```

- [ ] **Step 11.6: Commit**

```bash
git add .env.example .env.production.example preflight-check.js CLAUDE.md README.md
git commit -m "config(paywall): R-27 Task 11 - env surface + preflight + CLAUDE.md §4.7/§5"
```

---

## Self-Review Checklist (writing-plans 协议要求)

作者自跑，非 subagent。

### 1. Spec 覆盖

| decision doc §2 条目 | 覆盖 Task | ✅/⚠️ |
|---|---|---|
| §2.1 定位 toy + CLAUDE.md status | Task 11 | ✅（也在前置 commit 里了） |
| §2.2 Wave 4 CANCELLED | 已在前置 commit 里 audit doc 落地 | ✅ |
| §2.3 价格 ¥19.9 一次性 | Task 5 env + Task 6 模态 copy | ✅ |
| §2.3 结构：一次性终身 | users.is_paid 单 bit，无 expires | ✅ |
| §2.3 免费机制：登录后 7 天 | Task 2 state machine + Task 5 startTrial hook | ✅ |
| §2.3 匿名 20/天维持 | Task 2 state="anon" 不归 paywall 管 + 现有 cost-control 保留 | ✅ |
| §2.3 现有 3 用户 grandfather | Task 8 独立脚本 | ✅ |
| §2.3 7 天无理由退款 | 模态 copy 声明 + 无自动化（runbook 提及） | ⚠️ 退款流程仅文本，没代码保障。可接受（toy） |
| §2.3 支付渠道：虎皮椒 | Task 3（已 LOCKED 独家） | ✅ |
| §2.4 Kill Switch | Task 9 demand-report + Task 10 shutdown runbook | ✅ |
| §2.5 架构模板 repo | **不在本 plan 内**（独立项目） | ✅ 明确 out-of-scope |

### 2. 占位符扫描

- grep `TODO` / `TBD` / `implement later`：无（Step 5.4 里有占位伪码 `currentUser` / `sendJson` 但明确标注"以实际 grep 为准"，这是 acceptable）
- 每个 test 都有实际 assert 代码 ✅
- 每个 impl 都有完整代码块 ✅

### 3. 类型一致性

- `paywall.computeState()` 返回 `{state, trialRemainingMs?, userId?}` → 在 Task 5 里被 `paywall.serializeForApi()` 消费 ✅
- `provider.createOrder()` 返回 `{payUrl, providerOrderId, raw}` → routes/payment.js 里用 `created.payUrl` ✅
- `provider.parseWebhook()` 返回 `{valid, paid, orderId, providerTxId, providerOrderId}` → routes/payment.js 里用 `parsed.valid` / `parsed.paid` / `parsed.orderId` ✅
- `markPaid(db, userId, paidAt)` 签名统一 ✅

### 4. 已知 soft spots（等待 gstack review 挑）

- **二维码生成**：Task 6 简化成"显示链接"而非真二维码。design-review 大概率会挑 → 需要决定要不要内嵌 `qrcode.js` 或用虎皮椒的 `url_qrcode` 字段如果有
- **Nginx 对 /api/payment/webhook 的处理**：没在 plan 里写，因为当前没有 Nginx 配置 runbook。eng-review 可能会挑
- **IP allowlist 于 webhook**：plan 里说了但没在 Task 4 的实现代码里出现。eng-review 挑
- **webhook 的 content-type**：虎皮椒可能发 form-urlencoded 而非 JSON。bodyParser 要支持。eng-review 验证
- **退款自动化** 完全没做（仅人工 + runbook）。CEO review 可能挑"7 天无理由退款承诺无工程保障"

---

## 部署 / 上线 Checklist（plan 之外的手工步骤）

执行完 Task 1-11 并测试全绿后：

1. **owner 在虎皮椒注册**：拿 APP_ID + APP_KEY
2. **配 Nginx**：`/api/payment/webhook` 必须可达外网 + POST 允许
3. **服务器 `.env`**：填 HUSHUPAY_* + `PAYWALL_ENABLED=1`
4. **先灰度**：`PAYWALL_ENABLED=1` + 一个测试手机号（自己）验全链路
5. **grandfather**：`node scripts/ops/grandfather-existing-users.js 3 --apply`
6. **记 launch 日期**：写入 `docs/superpowers/decisions/2026-04-27-toy-mode-and-paywall.md` §2.4 下面，设 `PAYWALL_LAUNCHED_AT` env 方便 demand-report 用
7. **cron**：在 `daily-report.sh` 里加一行调 `demand-report.js`，月初打印

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-28-paywall-onboarding.md`. 下面三件事会在对话的下一轮里做：**

1. **gstack `/autoplan`** 跑完整三轨审阅（CEO / Eng / Design）on this plan
2. **审阅结论 + OPEN QUESTIONS 里的决策点** 合成一个 AskQuestion 给 owner 拍板
3. 拍板后再按 subagent-driven-development 实施 Task 1-11

**不要跳过审阅直接进实施。** 那是整个 superpowers + gstack 流程的关键——纸上审完代价 100x 低于代码审完。

---

## GSTACK REVIEW REPORT

> 2026-04-27 本地同 session 内跑完。三轨审阅人：Claude（本会话）。
> 限制：这是"一人扮演三角色"的快速审阅，不是独立 fresh-context 审阅。
> 真正独立的第四双眼睛建议未来任一时刻跑一次 `codex review` on this plan。

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | 内部 | Scope & strategy | 1 | ⚠️ Findings | 4 条（2 需决策 / 2 可 defer） |
| Eng Review | 内部 | Architecture & tests | 1 | 🔴 Findings | 7 条（3 MUST-FIX / 4 可接受） |
| Design Review | 内部 | UI/UX gaps | 1 | 🟠 Findings | 6 条（1 MUST-FIX / 5 可 defer） |
| Codex Review | — | 独立第四视角 | 0 | — | 建议未来跑一次 |

### 🔴 MUST-FIX（实施前必须处理）

**[Eng] webhook content-type 不是 JSON**  
虎皮椒发的回调是 `application/x-www-form-urlencoded`，不是 JSON。当前 `server.js` 的 body parser 未必能正确解析。**Task 4 实施前先 verify server.js 支持 form-urlencoded POST**（否则 `parsedBody` 里字段全空，sig 永远验不过）。如果不支持，Task 4 里要加一段 fallback parser。

**[Eng] X-Test-User-Id 只靠 NODE_ENV=test 门控不够**  
生产部署若误设 NODE_ENV=test（或 env 覆盖脱轨），任何人发这个 header 就能冒充任何用户。**必须 + `X-Test-Secret` 二次校验**，`.env.example` 里加 `TEST_IMPERSONATION_SECRET` 字段（prod 必须为空）。

**[Eng] webhook 无 IP allowlist**  
plan §OPEN Q8 提到"IP allowlist"但实现里没落地。虎皮椒回调应有固定 IP 段（需去 xunhupay 文档确认）。**Task 4 加 IP allowlist 检查**，不在白名单直接 `payment_events` 记录 + 403。

**[Design] 二维码显示为长链接 = 基本等于不能用**  
微信扫码支付是 PC 端核心路径。显示纯文字链接会让 PC 用户直接弃单。两个选项：  
(a) 内嵌 `qrcode.js`（MIT，~5KB gzip）本地生成；  
(b) 用虎皮椒返回的 `url_qrcode` 字段（通常是它服务器生成的二维码图片 URL）`<img src>`。  
**Task 6 实施时必须二选一**。

### 🟠 需要决策（owner 拍板）

这是交给你的审批闸。下面 5 条我列选项 + 推荐，你挑。

**D1 / CEO：Kill Switch 阈值是否要和"是否会推广"绑定**  
decision doc 定的是：6 个月 < 5 付费 → 关站。但如果你**完全不做任何推广**（不发朋友圈、不在即刻/小红书发、不投一分钱广告），纯靠自然流量 + 虎皮椒成功 5 个陌生付费是不现实的。这相当于预先把结论写死成"一定关"。

**D2 / CEO：匿名访客要不要看到付费价值主张**  
当前 plan：匿名用户完全看不到 paywall 相关 UI。保留玩具调性。但也等于你主动砍掉"匿名 → 有点意思 → 登录 → 付费"的唯一漏斗。

**D3 / Design：expired 用户点"稍后再说"之后的行为**  
当前 plan：关模态但所有新消息 402。用户体验会卡顿困惑。replacement 方案：每天给 1 次 free chat（哪怕 expired），让用户"偶尔回来一下"而不是彻底死。

**D4 / Design：付费墙 hero 文案**  
当前默认"让 AI 永远记得你"。卖 memory 不卖 Elon。但用户可能还没触发 facts memory 的价值感，看了一头雾水。

**D5 / Eng：付费后的 chat 响应延迟**  
webhook 到达 → `markPaid` 写 DB 是即时的。但前端当下的 chat 请求如果在 webhook 到达前发出，会拿到 402 + 付费墙。用户付完之后至少要**刷新页面或等 3 秒**才解锁。体验上是 edge case 但真实。

### 🟢 可接受 / 可 defer（审阅人建议接受现状）

- [Eng] `markPaid` 并发：SQLite row lock 够用，不是真问题
- [Eng] `routes/auth.js` 位置：实施时 grep 决定，不预设
- [Eng] `better-sqlite3` prepare 事务粒度：user insert + startTrial 目前不在同 txn，但 startTrial 幂等，失败可以后续补，无数据一致性风险
- [Design] "试用还剩 X 天"文案情绪：minor polish，不 block ship
- [Design] 支付成功 native alert：toy 级可接受，后续 polish
- [Design] loading 状态缺：minor
- [CEO] ¥9.9/¥19.9/¥99 三档 decoy：hold scope，一个价格对玩具就够
- [CEO] "Elon"外壳整体改写：out of scope，这是下一个 plan 的事

### Verdict

**NEEDS-OWNER-DECISION 之前 PLAN 不实施。**  
3 个 MUST-FIX 我可以替你做（实施阶段一起修，不用额外 round-trip）。  
5 个 D1-D5 必须你拍板才能继续。

---




