# CLAUDE.md — 给未来 AI agent 的驾驶员手册

这份文档是给**接手这个项目的 AI agent**看的（包括未来的 Claude / Cursor / Codex
session）。读完这一份，你能在 15 分钟内理解：项目是什么、关键设计决策为什么这样、
哪里有坑、改东西要先做什么。

---

## 1. 项目是什么

**Book of Elon**：基于《The Book of Elon》中文版的互动卡片 + AI 对话站点。
线上：https://bookofelon.cn

用户视角：
- 进首页看到一个极简对话框（Perplexity 风格），可以直接问 Elon 风格的 AI
- 也可以从主题卡进入特定话题
- 留下手机号登录后，AI 会**记住**你的"北极星目标"（一句话长期创业愿景）
  和你聊天里暴露的关键事实（intend / blocker / deadline / done / belief），
  并在后续对话里把这些注入 system prompt
- 右上角"我的路径"能看到自己的目标、关键事实、所有历史对话

商业目标（用户原话）：「指导用户的长期创业目标，做一个能持续陪伴的 AI 教练」。

---

## 2. 技术栈

| 层 | 技术 |
|---|---|
| 前端 | 静态 HTML + CSS + 原生 JS（无框架），客户端路由 |
| 后端 | Node.js 单进程 HTTP 服务（`server.js` ~2000 行） |
| 模型 | DeepSeek API (`deepseek-chat`)，本地知识降级 |
| DB | SQLite (`better-sqlite3`)，WAL 模式 |
| 短信 | 阿里云 SMS（HMAC-SHA1 自签 V1 协议） |
| 进程 | PM2（`book-of-elon` + `book-of-elon-monitor`） |
| 反代 | Nginx |
| 部署 | Linux 单机（阿里云 ECS） |

**没有用到**：React / Vue、TypeScript、Redis、Docker Compose、CI/CD pipeline。
保持简单是设计决策。

---

## 3. 目录速览

```
server.js                # HTTP 主入口，~2000 行（路由分派 + chat 编排 + LLM 调用）
preflight-check.js       # 上线前自检（生产模式会拒绝缺关键 env 启动）
monitor-server.js        # 独立监控后台（127.0.0.1:3201）
ecosystem.config.js      # PM2 配置

routes/
  auth.js                # /api/auth/* （send-code / verify-code / me / logout）
  me.js                  # /api/me/*   （dashboard / north-star / facts pin/archive）

db/
  database.js            # 单例 db handle + 启动时调 auto-migrate
  schema.sql             # 当前 schema（CREATE TABLE / INDEX / PRAGMA）
  auto-migrate.js        # 启动时自动跑：缺表/缺列幂等补齐，fail-fast
  sessions.js            # chat_sessions + messages，含原子 appendTurn
  users.js               # 手机号 → user，含 claimAnonSessions
  facts.js               # AI 抽取的关键事实
  goals.js               # 北极星目标
  sms.js                 # OTP 生成（crypto.randomInt）+ 节流

auth/
  sms-aliyun.js          # 阿里云短信签名 + 发送
  sms-sender.js          # provider 路由：aliyun 配齐 → 真发，否则 mock
  sms-throttle.js        # IP / phone / day 三层节流
  session-cookie.js      # HMAC-SHA256 签名的无状态 cookie
  fact-extractor.js      # 调 DeepSeek 从对话里抽 5 类 facts

prompts/
  system-prompt-v1.md    # 旧版（保留对照）
  system-prompt-v2.md    # 当前默认（Elon 强势风格）

scripts/                 # 已重组（Wave 2 Phase B, 2026-04-27）
  ops/                   # 运维必跑
    deploy.sh            # 一键部署
    init-db.js           # 第一次部署
    migrate.js           # 手工迁移（dry-run / apply）
    backup-db.js         # 热备份（cron 每 4h 跑）
  tools/                 # 一次性工具
    admin-report.js
    db-peek.js
    cleanup-claimed-sessions.js
    clean-test-pollution.js
    export-admin-snapshot.js

tests/
  smoke/                 # 单功能冒烟（auth/db/persistence/northstar/cost/static/prompt）
  e2e/                   # 端到端（full-flow / integration-memory / fact-extractor / jsdom-click）
  probe/                 # 实时探针（live-chat / prompt-injection-live / min）

data/
  app.db                 # SQLite 主库（备份这个！）
  backups/               # cron 备份产物
  business-metrics.json  # 业务指标累积

terminals/               # Cursor IDE 的终端镜像（不要碰）
```

---

## 4. 关键设计决策（改东西前先理解这些）

### 4.1 无状态 JWT-style session cookie

`auth/session-cookie.js` 用 HMAC-SHA256 签名 cookie，**服务端不维护 session 表**。
这意味着：
- `logout` 是下发 `Max-Age=0`，让浏览器丢 cookie。**服务端不会拉黑 token**。
- 旧 cookie 在 TTL 内（30 天）仍然有效——这是设计选择，不是 bug
- 修改 `USER_SESSION_SECRET` 会让所有 cookie 立即失效

**别尝试**：搞个 server-side session blacklist。这违反整个架构假设，要做请重新设计。

### 4.2 chat 落库走 appendTurn 原子事务

`db/sessions.js::appendTurn` 在一个事务里写 user 消息 + assistant 消息 + 更新
`turn_count`。这是 P0 修复的核心。

**改 chat 持久化的人请遵守**：
- 不要分开调 `saveUserMessage` / `saveAssistantMessage` —— 那会有半截写入风险
- 持久化失败时 `server.js::persistChatTurn` 会返回 `{ ok: false, reason }`，
  通过 `/api/chat` 响应里的 `persistence_ok=false` + `persistence_reason` 告诉前端
- 前端 `app.js` 看到 `persistence_ok=false` 会弹橙色 toast

### 4.3 启动时自动迁移，fail-fast

`db/auto-migrate.js` 在 `getDb()` 里被调用：
- 跑一遍 `schema.sql`（CREATE IF NOT EXISTS，幂等）
- 跑 `ADD_COLUMN_PATCHES` 列表（事务内）
- 校验所有 `EXPECTED` 表/列存在，否则**抛异常拒绝启动**

**加新表/新列的人请**：
1. 写到 `db/schema.sql`
2. 把 ALTER TABLE 加到 `auto-migrate.js::ADD_COLUMN_PATCHES`
3. 把表名/列名加到 `auto-migrate.js::EXPECTED`
4. 跑 `npm run db:migrate` dry-run，确认输出对
5. 部署后 `db/auto-migrate.js` 会自动跑

`NODE_ENV=test` 或 `SKIP_AUTO_MIGRATE=1` 时跳过（unit test 用）。

### 4.4 匿名数据不归户（重要产品决策）

用户匿名期间（只有 anon cookie）的所有 chat 落在 `chat_sessions.anon_id` 上，
**永远不会**被挂到任何 user_id 上。这是用户明确的产品决策：

> "匿名聊的不会保存在登录后的对话框里 行业都是这么做的"

实施细节：
- `routes/auth.js::handleVerifyCode` **不调用** `claimAnonSessions`
- verify-code 响应里 `claimedAnonSessions` 永远是 0
- `db/sessions.js::claimAnonSessions` 函数本身**保留**（unit test 还会调），
  但没有任何 HTTP 路径触达它
- `/api/me/import-local-session` 已被永久撤回（404）

**未来不要加回来这两条**之一，除非用户明确改主意。

历史上线时（2026-04-19 sha 9f2e6e7 之前）有过短暂的 claim 逻辑，那批
session 已经挂到 user_id 上、留在生产 DB 里——属于历史遗留，不主动清理。

如果将来要做"游客一键导入"功能（用户主动点按钮把匿名对话挂到自己账号下，
不是登录时自动），那是另一个产品 spec，需要重新设计 UX。

### 4.5 OTP 必须用 CSPRNG

`db/sms.js::createCode` 用 `crypto.randomInt(100000, 1000000)`，**不要**改回
`Math.random()`——那不是密码学安全的。e2e 测试有一项 10000 样本均匀性检查兜底。

### 4.6 .env 加载顺序

`server.js::loadEnvFile` 读 `.env`，但**只在 `process.env[key] === undefined` 时**
注入。所以你 shell 里 export 的环境变量永远赢 `.env`。这对调试和测试隔离很有用。

---

## 5. 必须设置的环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 是 | 否则 chat 走本地降级 |
| `USER_SESSION_SECRET` | **是** | 64 位 hex，签账号 cookie。**改了等于踢所有用户** |
| `SESSION_TOKEN_SECRET` | 是 | 签匿名 chat token，重启后失效会让用户刷新页面 |
| `SMS_PROVIDER` | 生产是 | `aliyun` 否则走 mock，**mock 模式验证码会以明文返回** |
| `ALIYUN_ACCESS_KEY_ID` | 生产是 | 用专用 RAM 子账号，最小权限只给 SMS |
| `ALIYUN_ACCESS_KEY_SECRET` | 生产是 | 同上 |
| `ALIYUN_SMS_SIGN_NAME` | 生产是 | 阿里云审核通过的签名（不是占位 `<请填真签名>`） |
| `ALIYUN_SMS_TEMPLATE_CODE` | 生产是 | 已审核通过的模板编号 |
| `MONITOR_USERNAME` / `MONITOR_PASSWORD` | 生产是 | 监控后台 basic auth |
| `SQLITE_DB_PATH` | 否 | 默认 `./data/app.db` |
| `PROMPT_VERSION` | 否 | `v1` 或 `v2`，默认 `v2` |

`preflight-check.js --strict-production` 会拦住缺关键 env 的启动。

---

## 6. 测试矩阵

| 命令 | 覆盖 | 何时跑 |
|---|---|---|
| `npm run preflight:prod` | 生产 env 完整性 | 每次部署前 |
| `npm run smoke:chat` | `/api/chat` 走通 | 每次部署后 |
| `npm run auth:smoke` | 登录全流程（**只能 mock 模式**） | dev / staging |
| `npm run persist:smoke` | 聊天原子落库 + claim | dev / staging |
| `npm run northstar:smoke` | 北极星 + dashboard | dev / staging |
| `npm run test:e2e` | 30 个断言端到端 | 大改之后 |

跑 `test:e2e` 需要先开一个隔离 dev server，参数见 `tests/e2e/full-flow.js` 顶部
注释（PowerShell 命令已经写好）。

---

## 7. 部署流程

服务器：`/root/skill_The_book_of_Elon`，仓库：`github.com:ab18108289/book-of-elon.git`。

```bash
cd /root/skill_The_book_of_Elon
bash scripts/ops/deploy.sh
```

`scripts/ops/deploy.sh` 自带 10 步：预检 → 备份 DB → git pull → npm ci → 迁移
dry-run → 迁移 apply → pm2 reload → 健康检查 → 烟测 → 总结。

---

## 8. 常踩的坑

### 8.1 在 PowerShell 里跑 e2e 拿不到 devCode
确认 `SMS_PROVIDER=mock` 已 export 到 process env。脚本里读 `process.env.SMS_PROVIDER`，
不读 `.env`（因为 `.env` 里写着 `aliyun`）。

### 8.2 `/api/chat` 报 401 / token invalid
匿名 chat 必须带服务端在 `/config.js` 里下发的 `chatSessionToken`。
跨域裸调一定 401。这是反爬保护，不是 bug。

### 8.3 改了 `USER_SESSION_SECRET` 所有用户被踢
**不要改**。要轮换的话准备好运营公告，让用户重新短信验证一次。

### 8.4 ALTER TABLE 在 transaction 里失败
`PRAGMA` 不能在事务里执行。`scripts/ops/migrate.js` 已经做了过滤，但如果你手写 SQL
迁移要小心。`db/auto-migrate.js` 把 PRAGMA 拉到事务外了。

### 8.5 cron 备份没跑
检查：
```bash
crontab -l                      # 应该有 backup-db.js 那行
tail -100 /var/log/boe-backup.log
ls -lh data/backups/            # 应该有最近 4h 内的 .db.gz
```

### 8.6 短信落款是 `<请填真签名>`
你忘了改 `ALIYUN_SMS_SIGN_NAME`。修复：
```bash
sed -i "s|^ALIYUN_SMS_SIGN_NAME=.*|ALIYUN_SMS_SIGN_NAME=方智云创|" .env
pm2 reload book-of-elon --update-env
```

### 8.7 修了 chat UI，AI 回复看着不对
检查 `prompts/system-prompt-v2.md` 是不是被改了。这是 v2 强势 Elon 风格的
single source of truth。改之前先读 `docs/quality/prompt-ab-report.md` 看历史评测。

---

## 9. 用户偏好（从历史会话总结）

- **极简风**，参考 Perplexity，反对花哨动画和 AI slop 视觉
- **不要打字机动画**——用户嫌慢
- 中文回复，但保留少量 Elon 标志性英文短语（"first principles", "the future"）
- 强势、直接、不安抚——AI 应该像 Elon 一样有压力感，不要"温柔助手"
- 重视数据持久化：用户原话 "每个用户的数据还是很重要的，不能让他们聊完过段时间进来就没了"
- 重视细节：modal 背景灰白色被反复指出过，需要深色玻璃质感
- **不要**主动加 emoji
- **不要**写"narrate-the-code"型注释（"这个变量是用户ID"）

---

## 10. 历史 P0 修复要点（不要再回退）

1. ✅ `appendTurn` 原子事务（`db/sessions.js`）—— 杜绝半截写入
2. ✅ `auto-migrate.js` 启动 fail-fast —— schema 不一致直接拒启动
3. ✅ OTP 用 `crypto.randomInt` —— 不是 `Math.random`
4. ✅ `import-local-session` 接口已撤回 —— 不要加回来
5. ✅ `claimAnonSessions` 已停止在 verify-code 时调用 —— 匿名数据不归户
6. ⏳ Aliyun key 永久删除（运维事项）

详见 git log：`git log --grep="P0"` 和 `git log --grep="claim"`。

---

## 11. 跟用户协作的节奏

用户偏好（从历史观察）：
- 直接说"继续"——意思是按你前面建议的下一步推进
- 给 PowerShell / SSH 终端输出截图 → 你需要从输出里读懂上下文
- 看到红色错误提示会立刻反馈
- 喜欢简短中文回复 + 关键命令块，不喜欢冗长解释
- 信任你做技术决策，但产品设计变化要先确认（比如撤回 import-local-session 那次）

---

读完这份，你应该可以接手任何任务。任何疑问先看：
1. 这份 `CLAUDE.md`
2. `git log --oneline -30`（最近 30 个 commit 包含设计意图）
3. `tests/e2e/full-flow.js`（30 个断言告诉你产品契约是什么）
