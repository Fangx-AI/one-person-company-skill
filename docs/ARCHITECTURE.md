# Architecture

> 本文回答"项目长什么样、数据怎么流、关键决策为何如此"。
> 改东西前 15 分钟必读，比 `CLAUDE.md` 更结构化。

## 1. 一句话定位

**Book of Elon** 是一个**单进程 Node.js + SQLite + DeepSeek 代理**的中文互动 AI 教练站点。
特征是：极简前端（无框架）、无状态 cookie 鉴权、跨会话 AI 记忆（北极星 + facts）、本地降级。

线上：`https://bookofelon.cn`

---

## 2. 系统拓扑

```
┌────────────────────────────────────────────────────────────┐
│  Browser                                                   │
│  ├─ index.html / app.js / styles.css （静态）              │
│  └─ /config.js  ← server 注入的匿名 chat token             │
└──────────────┬─────────────────────────────────────────────┘
               │ HTTPS
┌──────────────▼─────────────────────────────────────────────┐
│  Nginx (TLS 终止 + 反代)                                   │
└──────────────┬─────────────────────────────────────────────┘
               │ http://127.0.0.1:3000
┌──────────────▼─────────────────────────────────────────────┐
│  PM2 ─── book-of-elon (server.js)                          │
│         │                                                  │
│         ├─ HTTP 路由分派                                   │
│         ├─ 匿名 chat token 校验（HMAC）                    │
│         ├─ rateLimit + circuit breaker + cost guardrail    │
│         ├─ DeepSeek 代理 (services/cost-control + retry)   │
│         ├─ 落库 (db/sessions::appendTurn 原子事务)         │
│         └─ fact extraction (异步, services/fact-extractor) │
│                                                            │
│  PM2 ─── book-of-elon-monitor (monitor-server.js)          │
│         读 /health + pm2 jlist + PM2 日志                  │
│         basic auth, 仅 127.0.0.1:3201                      │
└──────────────┬─────────────────────────────────────────────┘
               │ 文件 / native binding
┌──────────────▼─────────────────────────────────────────────┐
│  SQLite (better-sqlite3, WAL)                              │
│  data/app.db                                               │
│  ├─ users / chat_sessions / messages                       │
│  ├─ facts (AI 抽取)                                        │
│  ├─ goals (北极星)                                         │
│  └─ sms_codes / analytics                                  │
└────────────────────────────────────────────────────────────┘
               │
               ↓
┌────────────────────────────────────────────────────────────┐
│  cron: scripts/backup-db.js  4h 一次 → data/backups/*.gz   │
└────────────────────────────────────────────────────────────┘
```

外部依赖：

- **DeepSeek API**（`api.deepseek.com/v1/chat/completions`）— LLM 上游，3 道闸守门
- **阿里云 SMS**（自签 V1 协议）— OTP 发送

**没有用到**：React / Vue · TypeScript · Redis · Docker Compose · CI/CD 流水线。
保持简单是设计决策。

---

## 3. 目录结构

```
server.js                # HTTP 主入口 (~2100 行，god-file，待拆，见 R-04)
preflight-check.js       # 上线自检（生产模式 fail-fast）
monitor-server.js        # 独立监控后台
ecosystem.config.js      # PM2 配置

routes/
  auth.js                # /api/auth/*  (send-code / verify-code / me / logout)
  me.js                  # /api/me/*    (dashboard / north-star / facts pin/archive)

db/
  database.js            # 单例 db handle + 启动时调 auto-migrate
  schema.sql             # CREATE TABLE / INDEX / PRAGMA
  auto-migrate.js        # 启动时跑：缺表/缺列幂等补齐 + EXPECTED 校验 fail-fast
  sessions.js            # appendTurn 原子事务（核心）
  users.js               # 手机号 → user
  facts.js               # AI 抽取的事实
  goals.js               # 北极星目标
  sms.js                 # OTP 生成 (CSPRNG) + 节流

auth/
  session.js             # HMAC-SHA256 签名 cookie（账号系统）
  sms-aliyun.js          # 阿里云短信签名 V1
  sms-sender.js          # provider 路由（aliyun / mock）
  sms-throttle.js        # IP / phone / day 三层节流

services/
  cost-control.js        # R-01 三道闸：global / per-IP / per-anon-session
  fact-extractor.js      # 调 DeepSeek 抽 5 类 facts（intend/blocker/deadline/done/belief）
  system-prompt.js       # 注入北极星 + facts 进 system prompt

prompts/
  system-prompt-v1.md    # 旧版（保留对照）
  system-prompt-v2.md    # 当前默认（Elon 强势风格）

scripts/                 # 待重组 (R-05, Wave 2 Phase B)
  init-db.js             # 第一次部署
  migrate.js             # 手工迁移（dry-run / apply）
  backup-db.js           # 热备份 + gzip + 轮转
  deploy.sh              # 一键部署
  smoke-*.js             # 各类冒烟（auth / persistence / northstar / cost / static / prompt）
  e2e-full-flow.js       # 30 个断言 e2e

data/
  app.db                 # SQLite 主库（备份这个！）
  backups/               # cron 备份产物
  business-metrics.json  # 业务指标累积

docs/
  DEPLOYMENT.md          # 部署单一信源
  ARCHITECTURE.md        # 本文
  runbooks/              # 救火手册
  superpowers/audits/    # 项目审计
  security/audits/       # CSO 安全审计
  archive/               # 已被取代的旧文档
```

---

## 4. 关键数据流

### 4.1 匿名用户 chat（最热路径）

```
Browser
  └─> POST /api/chat
      Headers: x-book-of-elon-token (HMAC 签名 ≤ 6h)
      Cookie:  book_of_elon_sid (anon_id)
      Body:    { messages: [...], sessionId? }

server.js::handleChatRequest
  1. requireSameOrigin / requireValidChatToken  (反爬)
  2. parseSessionContext (anon vs authed)
  3. costControl.preflightChat({ ip, anonSessionId, isAuthenticated })
       │  global daily token budget 满? → fallback
       │  per-IP daily token quota 满? → fallback
       │  匿名 session daily chat 满? → fallback
       │  (登录用户跳过最后一项)
       └─> ok / { ok:false, reason, retryAfter }
  4. rateLimit(per-IP: 60s/8 + 10s/3 burst)
  5. responseCache lookup (LRU 300, TTL 120s, 同 messages 命中)
  6. circuitBreaker.isOpen() → fallback
  7. systemPrompt = buildSystemPrompt(userId)
       注入：北极星目标 + 最近 8 条 facts (按 score)
  8. requestDeepSeek(messages + systemPrompt)
       timeout 15s, 1 次 retry, 失败 +1 circuit failure
  9. costControl.recordTokenUsage({ ip, totalTokens })
 10. db.appendTurn(sessionId, userMsg, assistantMsg)  ← 原子事务
 11. async: factExtractor.extract(messages, userId)
 12. response: { reply, sessionId, persistence_ok, degraded?, ... }
```

### 4.2 登录流（OTP）

```
Browser
  └─> POST /api/auth/send-code  { phone }
      │
      ├─ smsThrottle (IP 5/h, phone 3/h, day 50)
      ├─ db.sms.createCode (crypto.randomInt 100000-999999, TTL 5min)
      └─ smsSender.send (aliyun 真发 / mock 直接返回 devCode)

  └─> POST /api/auth/verify-code  { phone, code }
      │
      ├─ db.sms.verifyCode (compare + delete)
      ├─ db.users.upsertByPhone
      ├─ session.issue(userId)  → Set-Cookie HMAC-SHA256
      └─ ❗注意：verify-code **不调 claimAnonSessions**
              （产品决策：匿名期间数据不归户，见 §5.4）
```

### 4.3 跨会话记忆

```
用户登录后下次开始 chat
  ↓
buildSystemPrompt(userId)
  ↓
db.goals.getNorthStar(userId)   → "做能教 AI 编程的产品"
db.facts.listTop(userId, 8)     → [
                                    { kind:'intend', text:'下周做 demo' },
                                    { kind:'blocker', text:'还没找到种子用户' },
                                    ...
                                  ]
  ↓
拼到 system prompt 头部，DeepSeek 看见这些 + 用户当前问题
  ↓
回复包含上下文，"上次你说要做 demo, 现在卡在用户验证..."
```

---

## 5. 关键设计决策（改东西前先理解）

### 5.1 无状态 JWT-style session cookie

`auth/session.js` 用 HMAC-SHA256 签名，**服务端不维护 session 表**。

- `logout` = 下发 `Max-Age=0`，浏览器丢 cookie；**服务端不拉黑 token**
- 旧 cookie 在 TTL 内（30 天）仍有效——这是**设计选择**，不是 bug
- 修改 `USER_SESSION_SECRET` 会让所有 cookie 立即失效

**别尝试**搞 server-side session blacklist。这违反整个架构假设，要做请重新设计。

### 5.2 chat 落库走 appendTurn 原子事务

`db/sessions.js::appendTurn` 在一个事务里写 user 消息 + assistant 消息 + 更新 `turn_count`。
这是 P0 修复的核心。

**改 chat 持久化的人请遵守**：
- 不要分开调 `saveUserMessage` / `saveAssistantMessage` —— 半截写入风险
- 持久化失败 → `/api/chat` 返回 `persistence_ok=false` + `persistence_reason`
- 前端 `app.js` 看到 `persistence_ok=false` 弹橙色 toast

### 5.3 启动时自动迁移，fail-fast

`db/auto-migrate.js` 在 `getDb()` 里：

1. 跑 `schema.sql`（CREATE IF NOT EXISTS，幂等）
2. 跑 `ADD_COLUMN_PATCHES`（事务内）
3. 校验所有 `EXPECTED` 表/列存在 → 否则**抛异常拒绝启动**

**加新表/新列**：
1. 写到 `db/schema.sql`
2. 把 `ALTER TABLE` 加到 `auto-migrate.js::ADD_COLUMN_PATCHES`
3. 把表名/列名加到 `EXPECTED`
4. 跑 `npm run db:migrate`（dry-run）确认输出
5. 部署后 `auto-migrate.js` 自动跑

`NODE_ENV=test` 或 `SKIP_AUTO_MIGRATE=1` 时跳过。

### 5.4 匿名数据不归户（产品决策）

匿名期间的 chat 落在 `chat_sessions.anon_id`，**永远不会**挂到任何 `user_id`。

> 用户原话："匿名聊的不会保存在登录后的对话框里 行业都是这么做的"

实施：
- `routes/auth.js::handleVerifyCode` **不调** `claimAnonSessions`
- verify-code 响应里 `claimedAnonSessions` 永远 0
- `db/sessions.js::claimAnonSessions` 函数**保留**（unit test 还会调），但没有 HTTP 路径触达
- `/api/me/import-local-session` 已永久撤回（404）

**未来不要加回这两条**之一，除非用户明确改主意。

如果要做"游客一键导入"（用户主动按按钮挂数据，不是登录时自动），那是另一个产品 spec。

### 5.5 OTP 必须用 CSPRNG

`db/sms.js::createCode` 用 `crypto.randomInt(100000, 1000000)`。
**不要**改回 `Math.random()`——那不是密码学安全。
e2e 有一项 10000 样本均匀性检查兜底。

### 5.6 .env 加载顺序

`server.js::loadEnvFile` 读 `.env`，但**只在 `process.env[key] === undefined` 时**注入。
所以 shell 里 export 的环境变量永远赢 `.env`。这对调试和测试隔离很有用。

### 5.7 三道闸成本守门（R-01，2026-04-27）

`services/cost-control.js`：

| 闸 | 默认值 | 行为 |
|---|---|---|
| 全站每日 token 总额 | 2,000,000（≈¥10/天） | 满了所有人走 fallback |
| 单 IP 每日 token | 50,000 | 满了该 IP 走 fallback |
| 匿名 session 每日次数 | 20 | 登录跳过此项 |

加上 `DEEPSEEK_MAX_TOKENS=400`（旧 700）+ 输入侧收紧（单消息 800 字、历史 8 条、总 5000 字）。

详见 `docs/runbooks/incident-cost-spike.md`。

---

## 6. 核心模块 ABI（require 关系）

```
server.js
  ├─ routes/auth        ─ db/* + auth/* + services/*
  ├─ routes/me          ─ db/* + auth/session
  ├─ auth/session       ─ crypto
  ├─ auth/sms-sender    ─ auth/sms-aliyun + auth/sms-throttle
  ├─ db/sessions        ─ db/database
  ├─ db/users           ─ db/database
  ├─ db/goals           ─ db/database
  ├─ db/facts           ─ db/database
  ├─ services/cost-control       ─ (无依赖, 纯内存状态)
  ├─ services/fact-extractor     ─ DeepSeek API + db/facts
  ├─ services/system-prompt      ─ db/goals + db/facts + prompts/*
  └─ db/database        ─ better-sqlite3 + db/auto-migrate
```

`services/cost-control` 是**没有外部依赖的纯函数模块** + 内存状态——可以零成本加 unit test，
也方便未来换成 Redis-backed 实现（如果上多实例）。

---

## 7. 已知架构债 / 演进方向

按优先级（详细整改建议见 `docs/superpowers/audits/2026-04-27-project-audit.md`）：

| ID | 项 | 优先级 | 备注 |
|---|---|---|---|
| R-04 | `server.js` 拆 (~2100 行 god-file) | P1 | 拆 `services/chat-pipeline.js` / `chat-cache.js` / `rate-limit.js` |
| R-05 | `scripts/` 重组 ops/tools/calibration | P2 | Wave 2 Phase B |
| R-06 | `book-source.js` / `card-data.js` / `knowledge-base.js` 转 JSON 入 `data/` | P2 | Wave 2 Phase C |
| R-07 | `reply-engine.js` / `model-client.js` 移到 `services/` | P2 | Wave 2 Phase C |
| R-08 | `tests/` 目录化（smoke + e2e + integration） | P2 | Wave 2 Phase B |
| R-14 | 单实例 → 多实例（rateLimit/cache/cost 共享） | P3 | 流量起来了再做 |
| R-16 | `prompt:smoke` / `static:smoke` 接 CI（GitHub Actions） | P2 | 防回归 |

---

## 8. 性能 / 容量（当前观测）

- **请求量**：单实例够用，CPU < 5%
- **DB 大小**：~10MB（224 messages × 几百用户级），SQLite 完全 hold 得住到 1GB
- **DeepSeek 单次延时**：p50 1.5s / p95 4s（`SLOW_REQUEST_THRESHOLD_MS=4000`）
- **冷启动**：< 1s（auto-migrate 含）
- **PM2 reload**：zero-downtime

---

## 9. 安全姿态摘要

完整威胁模型：`docs/security/audits/2026-04-14-cso-audit.md`

已修复（P0/P1）：
- ✅ Static path traversal（`/data/app.db` 公开下载）→ 白名单
- ✅ Aliyun key in git history → 已轮换 + 历史保留待清理（CSO #4）
- ✅ Mock SMS in production → `preflight:prod` 拦截
- ✅ DeepSeek 滥用 → R-01 三道闸 + 输入收紧

未完待续：
- ⏳ R-02 Aliyun key git 历史清理（运维事项）
- ⏳ R-03 `.env` 移出 web cwd（用 systemd Environment 注入）
- ⏳ Server-side WAF（暂用 Nginx + Cloudflare 兜底）

---

## 10. 谁在 prod

| 进程 | 端口 | 暴露 | 用途 |
|---|---|---|---|
| `book-of-elon` | 3000 | Nginx 反代到 https | 主站 |
| `book-of-elon-monitor` | 3201 | 仅 127.0.0.1，SSH 隧道 | 运维监控页 |
| `nginx` | 80/443 | 公网 | TLS + 反代 |
| `cron` (backup-db) | — | — | 4h 一次备 SQLite |

数据落地：`/root/skill_The_book_of_Elon/data/app.db` + `data/backups/*.gz`

---

## 文档历史

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-04-27 | 首版（R-11 / Wave 2 Phase A） | Claude |
