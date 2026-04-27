# Book of Elon · Comprehensive Project Audit

| | |
|---|---|
| **审计日期** | 2026-04-27 |
| **审计员** | Claude (Cursor IDE, Opus 4.7) — 按 superpowers / brainstorming skill 流程 |
| **触发** | 用户原话："我现在觉得这个项目非常非常混乱  你用 superpower 完整且详细的审视一下这个项目" |
| **范围** | 用户勾选的 5 个维度：代码/架构、文件/目录、文档、部署/运维、安全/成本 |
| **形态** | 高层全景 + 每条问题带证据 + 修复建议 + 工时 + 路线图 |
| **基线** | git HEAD `1ec54ad` |

---

## 0. Executive Summary

### 综合评分

| 维度 | 分 | 一句话诊断 |
|---|---|---|
| 1. 代码 / 架构 | **5/10** | `server.js` 是 god-file（68 KB / ~2000 行 / 80+ 函数）；`db/` `services/` `auth/` 模块化已起步，但被 `server.js` 吞噬 |
| 2. 文件 / 目录组织 | **4/10** | 根目录 12 个 `.js` + 9 个 `.md` + 测试输出 + 数据 + 临时脚本全堆这里；`docs/` 是空的但 `.gstack/` 满 |
| 3. 文档 | **5/10** | `CLAUDE.md` 是项目最强单点资产；但 3 份 DEPLOY 文档高度重叠、有过期 plan、缺 ARCHITECTURE / CHANGELOG |
| 4. 部署 / 运维 | **4/10** | `scripts/deploy.sh` 是亮点；但救火靠肌肉记忆、没 staging、依赖编译没固化、Node ABI 升级踩坑 27 天才暴露 |
| 5. 安全 / 成本 | **6/10** | CSO P0/P1 都修了；但 cost guardrails 一直没上 → DeepSeek 烧 ¥100 才止血、`.env` 仍在 web cwd |
| **综合** | **4.8/10** | 内核扎实，外表凌乱。问题不是"代码不好"，是"项目没人在管秩序" |

### TL;DR

> **这不是一个糟糕的项目。这是一个**好工程被秩序问题拖着走**的项目。**
>
> - **核心代码质量**有亮点：`db/` 内部模块化、`appendTurn` 原子事务、CSP/HSTS、OTP CSPRNG、SMS 三层节流、CLAUDE.md 12.3 KB 写得专业
> - **但秩序在塌**：根目录堆了 35 个文件（12 .js + 9 .md + 数据 + 配置 + 临时输出）；3 份 DEPLOY 文档名字几乎一样；scripts/ 24 个文件混了 3 类用途没分组；最近 5 个 commit 全是修 bug 和补救工具，60 天 0 个 refactor commit
> - **运维一直在救火**：今天 1 小时内踩了 4 个坑（Node ABI / Workbench OSS / heredoc / sudo 嵌套）。这不是巧合，是缺 SOP 的体现
> - **DeepSeek 烧 ¥100** 是这种秩序状态的必然结果 —— 没 cost dashboard、没自动 cap、没 alerting，只能等账单见底才发现

### 推荐分波次执行

| Wave | 主题 | 工时 | 解决什么 |
|---|---|---|---|
| **Wave 1** | 止血（cost guardrails + 文件清理） | 4-6 h | 钱不再烧 + 心智负担 -50% |
| **Wave 2** | 文档重组 + 部署固化 | 4-6 h | 单一信源 + 救火 SOP |
| **Wave 3** | server.js 拆解 | 1-2 d | 可维护性 |
| **Wave 4** | 长期治理（CI、staging、监控告警） | 1-2 d | 防止回归 |

详见 §7 Remediation Roadmap。

---

## 1. 维度【代码 / 架构】— 5/10

### 1.1 现状速览

```
server.js                68.9 KB   ~2000 行   80+ 函数
monitor-server.js        29.9 KB   独立进程
app.js (前端)            27.3 KB
reply-engine.js          25.1 KB
auth-ui.js               22.8 KB
model-client.js          14.8 KB
preflight-check.js        7.6 KB
knowledge-base.js         6.3 KB
deepseek-eval.js          4.4 KB   一次性脚本
deepseek-smoke-test.js    4 KB     冒烟脚本
reply-calibration.js      2.9 KB   一次性脚本
ecosystem.config.js       0.9 KB

book-source.js          353.1 KB   纯数据，伪装成 .js
card-data.js             54.4 KB   纯数据，伪装成 .js
```

### 1.2 头号问题：`server.js` 是 god-file

**证据**：通过 grep `^(?:async\s+)?function\s+\w+` 数出 80+ 个顶层函数定义。职责至少 8 件：

| 职责 | 大致行号 | 应归属于 |
|---|---|---|
| HTTP 路由分派（含 `/health` `/ready` `/api/health` `/api/chat` `/api/analytics` `/config.js`） | 133-282 | `routes/` |
| Chat 编排（context 构造 / memory snapshot / fact extraction 调度） | 290-534 | `services/chat-orchestrator.js` |
| DeepSeek HTTP 调用 | 1196-1250 | `services/llm-client.js` |
| 本地 fallback 回复构造 | 1251-1306 | `services/local-fallback.js` |
| Rate limit + 缓存 + 熔断 | 1307-1579 | `middleware/` 或 `services/cost-control.js` |
| 静态文件服务（白名单 / MIME / gzip） | 911-1007 | `routes/static.js` |
| 健康检查（含 deepHealth） | 1462-1528 | `routes/health.js` |
| 安全（cookie 解析 / chat token / 同源检查 / IP 提取） | 1631-1900 | `middleware/security.js` |
| 启动 preflight | 75 + 1925 | 已部分在 `preflight-check.js`，但 server.js 里也有一份 |
| 日志事件 | 1581-1630 | `lib/logger.js` |

**routes/ 只有 2 个文件**：`auth.js`（/api/auth/*）+ `me.js`（/api/me/*）。其他所有路由都在 `server.js` 的中央 `if/else` 链里：

```163:228:server.js
    if (requestUrl.pathname === "/health") { ... }
    if (requestUrl.pathname === "/ready") { ... }
    if (requestUrl.pathname === "/api/health") { ... }
    if (requestUrl.pathname === "/config.js") { ... }
    if (requestUrl.pathname === "/api/analytics") { ... }
    if (requestUrl.pathname === "/api/chat") { ... }
    if (requestUrl.pathname.startsWith("/api/auth/")) { ... }
    if (requestUrl.pathname.startsWith("/api/me/")) { ... }
    // 兜底走 serveStaticFile
```

**为什么这是问题**：
- 改一个 chat 路径要在 ~2000 行的文件里 grep
- 单元测试不可能（路由 + 编排 + LLM + 缓存全耦合在一个 closure 链里）
- 新人 onboarding：CLAUDE.md 第 47 行写 `server.js # HTTP 主入口，~2000 行` —— 已经默认这是一个无法拆解的事实

**修复建议**（建议作为 Wave 3 单独执行）：拆成

```
server.js                       ~150 行  仅启动 + 路由表 + 中间件链
routes/
  health.js                     /health, /ready, /api/health
  static.js                     兜底静态资源（含白名单和 MIME）
  config.js                     /config.js (runtime config 注入)
  analytics.js                  /api/analytics
  chat.js                       /api/chat (现有的 handleChatRequest 整体搬过来)
  auth.js                       (已存在)
  me.js                         (已存在)
services/
  chat-orchestrator.js          memory snapshot, context, fact extraction 调度
  llm-client.js                 DeepSeek 调用 + 错误归类
  local-fallback.js             buildLocalFallbackReply + getFallbackIntro
  cost-control.js               rate limit + cache + circuit breaker
middleware/
  security.js                   cookie / chat token / origin / IP
  logger.js                     logEvent + logRequest
```

每个文件 200-400 行。`server.js` 退化为路由组装文件。**估算**：1-2 天，需要 e2e 测试套件兜底（已有 `scripts/e2e-full-flow.js`，30 个断言）。

### 1.3 数据混在 `.js` 里

**证据**：

```
book-source.js          353.1 KB   "module.exports = { chapters: [...] }"
card-data.js             54.4 KB   "module.exports = { cards: [...] }"
knowledge-base.js         6.3 KB   "module.exports = { knowledge: [...] }"
reply-test-set.json       11 KB    （这个对了，是 .json）
```

`book-source.js` 是《埃隆之书》的全文 OCR 输出 —— **不是代码**。把它放在 `.js` 文件里意味着：
- 每次 `node server.js` 启动，V8 都要 parse 353 KB JS（实际只为了读 JSON-shape 数据）
- 改卡片内容要 git diff `.js` 文件，没有 schema 校验
- 编辑器把它当代码，加载慢

**修复建议**：

```
data/
  book-source.json        ← 从 book-source.js 抽 module.exports.chapters
  cards.json              ← 从 card-data.js 抽
  knowledge-base.json     ← 从 knowledge-base.js 抽
  app.db                  (已有)
  business-metrics.json   (已有)
```

服务端用 `JSON.parse(fs.readFileSync(...))` + 启动时 cache 一次。**估算**：30-45 分钟。

### 1.4 Reply 这套散落

**证据**：根目录里 reply 相关 6 个文件没集中：

```
reply-engine.js              25.1 KB  → 应在 services/
model-client.js              14.8 KB  → 应在 services/
reply-calibration.js          2.9 KB  → 应在 scripts/calibration/
reply-calibration-output.md  26.9 KB  → 应在 .gitignore（已经在了，但还在 working tree）
reply-test-set.json          11 KB    → 应在 tests/fixtures/
reply-test-strategy.md        1.7 KB  → 应在 docs/
deepseek-eval.js              4.4 KB  → 应在 scripts/calibration/
deepseek-eval-output.md       3.8 KB  → 应在 .gitignore（已经在了）
deepseek-smoke-test.js        4 KB    → 应在 scripts/
prompt-ab-report.md           8.6 KB  → 应在 docs/archive/
```

**修复建议**：合并到 §2 的目录重组方案。**估算**：约 1 小时。

### 1.5 ✅ 亮点（保留 / 不要动）

- **`db/` 内部模块化**：`sessions.js` `users.js` `facts.js` `goals.js` `sms.js` `database.js` `auto-migrate.js` 各管一摊，接口清晰
- **`appendTurn` 原子事务**（`db/sessions.js`）：一次事务写 user 消息 + assistant 消息 + turn_count 更新，没有半截写入
- **`auto-migrate.js` fail-fast**：缺表/缺列直接拒启动，不是 silent 跑下去
- **`services/system-prompt.js` 服务端化**：CSO #2 的修复，client 不能再覆盖 system prompt
- **`auth/` 三层**：`session.js`（HMAC-SHA256 签名 cookie）+ `sms-aliyun.js`（V1 协议自签）+ `sms-sender.js`（mock/aliyun 路由 + prod fail-fast）
- **`monitor-server.js` 独立进程**：不影响主站、自带 Basic Auth、绑 127.0.0.1

---

## 2. 维度【文件 / 目录组织】— 4/10

### 2.1 头号问题：根目录是垃圾堆

**证据 — 根目录非配置类文件清单（35 个）**：

```
[js × 14]
  server.js                       ✓ 主入口
  monitor-server.js               ✓ 监控入口
  ecosystem.config.js             ✓ PM2 配置
  preflight-check.js              ⚠ 应在 scripts/ 或 lib/
  knowledge-base.js               ⚠ 是数据，应在 data/
  card-data.js                    ⚠ 是数据，应在 data/
  book-source.js                  ⚠ 是数据，应在 data/（且改 .json）
  reply-engine.js                 ⚠ 应在 services/
  model-client.js                 ⚠ 应在 services/ 或 client/
  reply-calibration.js            ⚠ 应在 scripts/calibration/
  deepseek-eval.js                ⚠ 应在 scripts/calibration/
  deepseek-smoke-test.js          ⚠ 应在 scripts/
  app.js                          ✓ 前端入口（保留根目录或移 public/）
  auth-ui.js                      ⚠ 前端，应跟 app.js 同处

[md × 9]
  README.md                       ✓ 必须根目录
  CLAUDE.md                       ✓ 项目级 AI 指南，根目录可
  DEPLOY.md                       ⚠ 跟 RUNBOOK 重叠
  DEPLOY_RUNBOOK.md               ⚠ 跟 DEPLOY 重叠
  DEPLOY_CHECKLIST.md             ⚠ 跟另两份重叠
  OBSERVABILITY.md                ⚠ 应在 docs/
  launch-readiness-plan.md        ⚠ 已过期（3/28 last touch），应归档
  reply-test-strategy.md          ⚠ 应在 docs/
  prompt-ab-report.md             ⚠ 应在 docs/archive/

[输出产物 × 2]
  reply-calibration-output.md     ✗ 测试输出，不该入仓库（已在 .gitignore，但在 working tree）
  deepseek-eval-output.md         ✗ 同上

[前端资源 × 3]
  index.html                      ✓ 前端入口
  styles.css                      ✓
  reply-test-set.json             ⚠ 应在 tests/fixtures/

[配置 × 6]
  package.json                    ✓
  package-lock.json               ✓
  .env.example                    ✓
  .env.production.example         ✓ 跟 .env.example 部分重叠
  .gitignore                      ✓
  .dockerignore                   ✓

[其他]
  Dockerfile                      ✓
  nginx.book-of-elon.conf.example ✓
  data/                           ✓ 目录
  prompts/                        ✓ 目录（system-prompt-v2.md 一个文件）
  scripts/                        ✓ 目录
  routes/                         ✓ 目录
  services/                       ✓ 目录
  auth/                           ✓ 目录
  db/                             ✓ 目录
  docs/                           ✗ 空目录
  .gstack/                        ⚠ gitignored 但有 audit 内容
```

**判定**：根目录应只保留：
- `README.md` `CLAUDE.md`（项目级文档）
- `package.json` `package-lock.json` `.env.example` `.env.production.example`
- `.gitignore` `.dockerignore`
- `Dockerfile`（如果保留 Docker 路径）
- `ecosystem.config.js`（PM2 入口）
- `nginx.book-of-elon.conf.example`
- `server.js` `monitor-server.js`（main entry points）
- `index.html` `styles.css` `app.js`（如果不引入 `public/` 拆分）

**其他都该挪走**。

### 2.2 `docs/` 是空的，但 `.gstack/` 满

```
docs/                           0 文件
.gstack/security-reports/       2 文件（CSO audit md + json）
```

`.gstack/` 在 `.gitignore` 里 —— 意味着 CSO 报告**不在 git 历史里**，是本地副本。一旦换机器或删 `.gstack/` 就丢了。这是个隐性资产流失风险。

**修复建议**：把 CSO 报告（已有的、未来的）落到 `docs/security/audits/` 并入仓库。这是项目治理资产，应该跟代码一起走。

### 2.3 `scripts/` 没分组

**证据 — 24 个文件混了 3 类用途**：

```
[生产运维 × 6]                          [一次性 ops 工具 × 6]
  init-db.js                              admin-report.js              (今天加的)
  migrate.js                              export-admin-snapshot.js     (前几天加的)
  backup-db.js                            db-peek.js
  cleanup-claimed-sessions.js             live-chat-probe.js
  deploy.sh                               probe-min.js
  watch-prod.ps1                          prompt-ab-test.js

[smoke / e2e × 11]                      [其他 × 1]
  smoke-auth.js                           clean-test-pollution.js
  smoke-db.js
  smoke-persistence.js
  smoke-northstar.js
  smoke-static-security.js
  smoke-prompt-injection.js
  smoke-prompt-injection-live.js
  e2e-full-flow.js
  test-fact-extractor.js
  integration-memory.js
  jsdom-click-test.js
```

**修复建议**：

```
scripts/
  ops/                          # 生产运维（cron / deploy 用）
    init-db.js
    migrate.js
    backup-db.js
    cleanup-claimed-sessions.js
    deploy.sh
    watch-prod.ps1
  tools/                        # 一次性 / 临时调试（明天又会来一个）
    admin-report.js
    export-admin-snapshot.js
    db-peek.js
    live-chat-probe.js
    probe-min.js
    prompt-ab-test.js
  calibration/                  # 模型 / prompt 校准
    deepseek-eval.js
    reply-calibration.js
    deepseek-smoke-test.js
tests/
  smoke/                        # 现有 smoke-*.js
  e2e/                          # e2e-full-flow.js
  integration/                  # integration-memory.js
  unit/                         # test-fact-extractor.js
  fixtures/
    reply-test-set.json
```

`package.json` 里的 `scripts.*` 路径要相应更新。**估算**：1.5 小时（含 git mv + 路径修复 + smoke 验证）。

### 2.4 测试输出还在 working tree

```
reply-calibration-output.md   26.9 KB
deepseek-eval-output.md        3.8 KB
```

`.gitignore` 里有这两个文件名，但**它们已经在 working tree 里**（gitignore 只对 untracked 起作用）。`git ls-files | grep -E 'output\.md'` 应该看不到它们 —— 但本地 `ls` 看得到，新 clone 出来不会有，造成"我本地有但仓库没"的错觉。

**修复建议**：直接 `rm` 删掉，因为它们是脚本输出产物，跑一次 `npm run test:reply` / `npm run test:deepseek` 就重新生成。**估算**：5 分钟。

### 2.5 完整目录重组方案（建议作为 Wave 2 一部分）

```diff
  /
  ├─ README.md
  ├─ CLAUDE.md
  ├─ package.json
  ├─ package-lock.json
  ├─ .env.example
  ├─ .env.production.example
  ├─ .gitignore                      # 补强（见 §2.6）
  ├─ .dockerignore
  ├─ Dockerfile
  ├─ ecosystem.config.js
  ├─ nginx.book-of-elon.conf.example
  ├─ server.js
  ├─ monitor-server.js
  ├─ index.html
  ├─ styles.css
  ├─ app.js                          # 前端入口（如果不引 public/ 暂留根目录）
  ├─ auth-ui.js                      # 跟 app.js 同处
  │
  ├─ data/
  │  ├─ app.db (gitignored)
  │  ├─ business-metrics.json
+ │  ├─ book-source.json             # 从 book-source.js 转
+ │  ├─ cards.json                   # 从 card-data.js 转
+ │  └─ knowledge-base.json          # 从 knowledge-base.js 转
  │
  ├─ db/                             # 不动，已经很好
  ├─ routes/                         # Wave 3 扩展（新增 chat.js / health.js / static.js / config.js / analytics.js）
  ├─ services/                       # Wave 3 扩展
+ │  ├─ reply-engine.js              # 从根目录搬
+ │  ├─ model-client.js              # 从根目录搬
+ │  └─ system-prompt.js             # 已存在
  ├─ auth/                           # 不动
+ ├─ middleware/                     # Wave 3 新建
  ├─ prompts/                        # 不动
  │
  ├─ scripts/
  │  ├─ ops/
  │  │  ├─ init-db.js
  │  │  ├─ migrate.js
  │  │  ├─ backup-db.js
  │  │  ├─ cleanup-claimed-sessions.js
  │  │  ├─ deploy.sh
  │  │  └─ watch-prod.ps1
  │  ├─ tools/
  │  │  ├─ admin-report.js
  │  │  ├─ export-admin-snapshot.js
  │  │  ├─ db-peek.js
  │  │  ├─ live-chat-probe.js
  │  │  ├─ probe-min.js
  │  │  └─ prompt-ab-test.js
  │  └─ calibration/
  │     ├─ deepseek-eval.js
  │     ├─ reply-calibration.js
  │     └─ deepseek-smoke-test.js
  │
  ├─ tests/
  │  ├─ smoke/                       # 现有 smoke-*.js
  │  ├─ e2e/
  │  │  └─ e2e-full-flow.js
  │  ├─ integration/
  │  │  └─ memory.js
  │  ├─ unit/
  │  │  └─ fact-extractor.js
  │  └─ fixtures/
  │     └─ reply-test-set.json
  │
+ ├─ docs/                           # 从根目录搬 6 个 md + 新建分类
+ │  ├─ ARCHITECTURE.md              # 新建（从 CLAUDE.md §3 抽出）
+ │  ├─ DEPLOYMENT.md                # 合并 3 份 DEPLOY 为 1 份
+ │  ├─ OPERATIONS.md                # 合并 OBSERVABILITY + 救火 SOP
+ │  ├─ CHANGELOG.md                 # 新建
+ │  ├─ runbooks/
+ │  │  ├─ incident-cost-spike.md    # 新建（DeepSeek 烧 ¥100 那次的经验）
+ │  │  ├─ incident-pm2-errored.md   # 新建（今天 Node ABI 那次的经验）
+ │  │  └─ data-snapshot-pii-safe.md # 新建（admin-report.js 用法）
+ │  ├─ archive/
+ │  │  ├─ launch-readiness-plan.md  # 已废弃，归档
+ │  │  ├─ reply-test-strategy.md    # 历史
+ │  │  └─ prompt-ab-report.md       # 历史
+ │  ├─ security/
+ │  │  └─ audits/
+ │  │     ├─ 2026-04-14-cso-audit.md     # 从 .gstack/ 搬来入仓库
+ │  │     └─ 2026-04-14-cso-audit.json
+ │  └─ superpowers/
+ │     └─ audits/
+ │        └─ 2026-04-27-project-audit.md  # 本文件
```

### 2.6 `.gitignore` 需要补强

**现状** (12 行)：

```
.env
.env.local
.env.production.local
node_modules/
*.log
*.pid
reply-calibration-output.md
deepseek-eval-output.md
*.backup.*
The Book of Elon.epub
The Book of Elon A Guide to Purpose and Success.pdf
data/
.gstack/
```

**漏掉**：

```diff
+ # SQLite WAL 副本（一旦从 data/ 跑出来不会被忽略）
+ *.db
+ *.db-shm
+ *.db-wal
+
+ # 临时与 IDE
+ .vscode/
+ .idea/
+ *.tmp
+ tmp/
+
+ # OS
+ .DS_Store
+ Thumbs.db
+
+ # 备份脚本副产
+ *.predeploy-*
+ *.bak
```

`.gstack/` 已经 gitignore，但建议**把里面的 audit 报告搬到 `docs/security/audits/` 入仓库**（资产保留），剩余的工具产物维持 ignored。

---

## 3. 维度【文档】— 5/10

### 3.1 头号问题：3 份 DEPLOY 文档高度重叠

**证据 — 内容覆盖矩阵**：

| 主题 | DEPLOY.md | DEPLOY_RUNBOOK.md | DEPLOY_CHECKLIST.md |
|---|:-:|:-:|:-:|
| 必填环境变量列表 | ✓ §2.1 | ✓ §3 | ✓ §1 |
| 阿里云 SMS 配置 | ✓ §2.2 | ✓ §3 | ✓ §1 |
| `npm run preflight:prod` | — | ✓ §4 | ✓ §2 |
| 数据库初始化 | — | ✓ §3.4 | — |
| 迁移 dry-run + apply | ✓ §3 | ✓ §3.4 | — |
| PM2 启动 | ✓ §3.5 | ✓ §5 | ✓ §4 |
| `pm2 startup` sudo 提示 | — | ✓ §5 | ✓ §4 |
| 健康检查（`/health`、`/ready`、`/api/health`） | ✓ §4.1 | ✓ §6 | ✓ §5 |
| Nginx + HTTPS | — | ✓ §7-8 | — |
| 真手机号短信测试 | ✓ §4.4 | — | ✓ §7.5 |
| 烟测命令清单 | ✓ §4 | ✓ §9 | ✓ §3 |
| **回归测试 6 步** | ✓ §5 | ✓ §9 | ✓ §6-7.5 |
| **回滚** | ✓ §6 | ✓ §11 | — |
| **数据持久 + 备份** | ✓ §6.5 | ✓ §11 | ✓ §7.6 |
| **cron 备份配置** | ✓ §6.5.3 | ✓ §11 | — |
| **rsync / OSS 异地备份** | ✓ §6.5.4 | — | — |
| **灾难恢复演练** | ✓ §6.5.5 | — | — |
| 监控 / 告警建议 | ✓ §7 | ✓ §10 | — |
| 一键 deploy.sh | — | ✓ §11.5 | — |
| 安全确认（最小权限 / git 历史无 .env） | — | — | ✓ §7.7 |
| 多实例边界 | — | ✓ §12 | ✓ §8 |
| Soft failures（已知问题） | ✓ §8 | — | — |

**判定**：3 份文档**至少 70% 内容重复**，分歧点：

- DEPLOY.md 独有：rsync/OSS 异地备份、灾难恢复演练、soft failures 清单
- DEPLOY_RUNBOOK.md 独有：Nginx + HTTPS、一键 deploy.sh、多实例边界
- DEPLOY_CHECKLIST.md 独有：安全确认（最小权限、git 历史检查）

**修复建议**：合并为**单份 `docs/DEPLOYMENT.md`**，按生命周期组织：

```
docs/DEPLOYMENT.md
├─ 1. First-time setup    （服务器装机 / Node / pm2 / nginx）
├─ 2. Environment config  （所有 env vars + 生成 secret）
├─ 3. Routine deploy      （bash scripts/ops/deploy.sh 是 canonical 路径）
├─ 4. Smoke tests         （deploy.sh 自带 + 浏览器 6 步回归）
├─ 5. Rollback            （代码 + DB）
├─ 6. Backup & DR         （cron + rsync/OSS + 演练剧本）
├─ 7. Monitoring          （/api/health 三态 + 告警接入）
├─ 8. Multi-instance      （未来扩展）
└─ Appendix: Security pre-flight checklist
```

把 3 份原文档归档到 `docs/archive/`。**估算**：2 小时（合并 + 重写 + cross-link 更新）。

### 3.2 `README.md` (7.7 KB) 与 `CLAUDE.md` (12.3 KB) 高度重叠

**重叠点**：

| 内容 | README | CLAUDE.md |
|---|:-:|:-:|
| 项目是什么 | ✓ | ✓ §1 |
| 技术栈 | 隐式（散在文中） | ✓ §2（清晰表） |
| 目录速览 | — | ✓ §3 |
| 环境变量列表 | 部分（§"本地启动"） | ✓ §5（完整表） |
| `npm run *` 命令清单 | ✓ "常用脚本" | ✓ §6（测试矩阵） |
| Docker 启动 | ✓ | — |
| PM2 启动 | ✓ | — |
| 监控后台说明 | ✓ "独立监控后台" | — |
| 健康检查 | ✓ §"健康检查" | — |
| 数据持久化 | ✓ §"数据持久化与备份" | — |
| 关键设计决策 | — | ✓ §4（详细） |
| 历史 P0 修复要点 | — | ✓ §10 |
| 用户偏好 | — | ✓ §9 |

**判定**：
- `CLAUDE.md` 是**给 AI agent 的 onboarding 文件** —— 写得专业、信息密度高
- `README.md` 是**给人类开发者的入门** —— 但内容重叠 + 部分表述不如 CLAUDE.md 准确（例如 README "环境要求" 只说 "Node.js >=20"，CLAUDE.md 完整列了所有 env vars）

**修复建议**：保留两份，但**职责分清**：

- `README.md` 精简到 ~3 KB：项目一句话简介 → quickstart（克隆/装/跑）→ 核心 npm scripts → 链接到其他文档
- `CLAUDE.md` 保留现状（它是好东西）
- 重复内容（环境变量、设计决策、目录结构）以 CLAUDE.md 为单一信源，README 用 `详见 CLAUDE.md §X` 引用

**估算**：30 分钟。

### 3.3 缺失文档

| 文档 | 影响 | 建议 |
|---|---|---|
| `docs/ARCHITECTURE.md` | 架构图藏在 CLAUDE.md §3 "目录速览"，新人看不到数据流 / 请求生命周期 | 抽出 + 加 1-2 张 mermaid 图 |
| `docs/CHANGELOG.md` | `package.json` `version: "1.0.0"` 永远不动；27 commits / 60 天没有节奏感 | 简单一份 Keep a Changelog 格式即可 |
| `docs/runbooks/` | 每次出事都重新发明流程（今天的 Node ABI / Workbench / DeepSeek 烧钱） | 按事件类型建几份 runbook |
| `SECURITY.md` | 不知道遇到漏洞怎么报 | 一段话即可 |

### 3.4 过期文档

```
launch-readiness-plan.md   3.3 KB   last touch: 3/28（4 周没动）
```

按文件名是上线前的 plan，从 git log 看上线 4 周后还在仓库根目录占位。**判定**：归档到 `docs/archive/`。

`prompt-ab-report.md` (8.6 KB)、`reply-test-strategy.md` (1.7 KB) 也是历史评测产物，建议同样归档。

### 3.5 ✅ 亮点

- **`CLAUDE.md` 12.3 KB** 是项目最强单点资产：第 4 节"关键设计决策"详细解释了为什么 logout 不拉黑 token、为什么匿名数据不归户、为什么用 fail-fast migration —— 这种**为什么**型文档 99% 项目都没有
- **`OBSERVABILITY.md`** 虽然只有 2.5 KB，但定义了关键 log event（`server_failed_to_listen` / `upstream_request_failed` / `slowRequest=true` / `degraded=true`），DEPLOY_RUNBOOK 引用了它

---

## 4. 维度【部署 / 运维】— 4/10

### 4.1 头号问题：救火靠肌肉记忆，没 SOP

**证据 — 今天 1 小时内踩的 4 个坑**：

| # | 现象 | 根因 | 当前状态 |
|---|---|---|---|
| 1 | `book-of-elon` PM2 errored 51 次重启 | 系统 Node 升 22 但 `node_modules/better-sqlite3` 还是 Node 20 ABI 编译，今天 `pm2 reload --update-env` 触发新进程加载就崩 | 已修（`npm rebuild better-sqlite3`） |
| 2 | Workbench "下载到本地" 失败 | 阿里云 Workbench 下载走 `oss-cn-hongkong-internal.aliyuncs.com` 中转，服务器到 OSS internal endpoint 网络不通 | 没修（绕过：用 git pull 路径） |
| 3 | 多行 heredoc 粘贴丢失/错位 | Workbench 网页终端粘贴 buffer 限制 | 没修（绕过：把脚本提交到 git，让用户 pull 后跑） |
| 4 | `sudo -i` 嵌套 + cd 失效 | sudo -i 启动新 shell，吃掉后面的 cd 命令 | 没修（教育用户：分两步） |

**这些不是 4 个孤立的坑，是 4 个"没 SOP"的体现**：
- 坑 1：依赖编译没固化 → 应该 `pm2 reload` 前自动检查 `better-sqlite3` 是否兼容当前 Node
- 坑 2：文件传输路径没备份方案 → 应该 runbook 里有"Workbench 下载失败时的 plan B"
- 坑 3：服务器执行临时脚本没标准方式 → 应该有 `scripts/tools/` + 用 git pull 当 canonical 通道
- 坑 4：服务器接入流程没文档 → CLAUDE.md / docs/ 里没写 Workbench 怎么用

**修复建议**（建议作为 Wave 2 一部分）：

新建 `docs/runbooks/`：

```
docs/runbooks/
├─ incident-pm2-errored.md         # 「pm2 process is errored」5 步诊断 → 修复 → 验证
├─ incident-cost-spike.md          # 「DeepSeek 在烧钱」止血 → 诊断 → 加 guardrail
├─ data-snapshot-pii-safe.md       # 「我要看后台对话数据」用 admin-report.js 的标准流程
├─ server-access.md                # 「我要 SSH 到服务器」Workbench / SSH key / sudo 标准姿势
└─ deps-rebuild-after-node-upgrade.md  # 「系统 Node 升级后服务挂了」原生模块 rebuild 流程
```

每个 runbook ~30-50 行，按"现象 → 诊断 → 修复 → 验证 → 引用"组织。**估算**：1.5 小时（5 份 runbook，每份 15-20 分钟，从 transcript 还原经验）。

### 4.2 多种部署路径并存，canonical 不清

**证据**：仓库支持 4 种部署路径：

| 路径 | 入口 | 状态 |
|---|---|---|
| `bash scripts/deploy.sh` | 一键，10 步流水线 | **canonical（应该）** |
| `pm2 start ecosystem.config.js` | PM2 直接启 | 备用，新机器首次部署 |
| `docker build && docker run` | Dockerfile 路径 | 文档里提了，**实际没人用**，但 Dockerfile 漏洞还在（CSO #4 已修） |
| 手动 SSH `git pull && npm ci && pm2 reload` | 救火时用 | 应该被 deploy.sh 取代 |

**判定**：4 种路径并存导致：
- 新人不知道该用哪个
- DEPLOY.md / RUNBOOK / CHECKLIST 各有侧重，进一步加深困惑
- Dockerfile 在但没人用 + 没 CI 跑 = 慢慢腐烂的代码

**修复建议**：
1. 在 `docs/DEPLOYMENT.md` 明确写 `bash scripts/ops/deploy.sh` 是 canonical
2. 其他路径标 "alternative" 或 "for first-time setup only"
3. Docker 路径：决定**保留**（但加 CI 测试构建）或**删除**（连 Dockerfile + .dockerignore + README §"Docker 启动" 一起删）。我推荐**删除**，因为 27 commit / 60 天都没有 docker 相关 fix → 实际没人在用

**估算**：1 小时（写决策 + 改文档 + 选择性删 Docker）。

### 4.3 没有 staging

**证据**：CLAUDE.md §7 部署流程：

```
服务器：/root/skill_The_book_of_Elon
仓库：github.com:ab18108289/book-of-elon.git

cd /root/skill_The_book_of_Elon
bash scripts/deploy.sh
```

只有一个生产环境。改完 main → push → 服务器 deploy → 用户立刻看到。

**风险**：
- 任何 prod bug 都是用户先发现
- Schema 迁移（`auto-migrate.js`）首次接触真实数据是上线那一刻
- 短信测试只能用真手机号 + 真验证码（消耗短信费）

**修复建议**（中长期，Wave 4）：

最简方案 —— 同一台服务器跑 staging 副本：
- 端口 3010（prod 是 3000）
- DB：`data/staging.db`（独立）
- nginx：`staging.bookofelon.cn`（子域名 + Basic Auth）
- PM2：`book-of-elon-staging` app
- deploy 流：`scripts/ops/deploy.sh --env=staging` 部署到 staging，验证通过后再 `--env=production`

**估算**：半天（配置 + 测试）。

### 4.4 没自动 alerting

**证据**：
- `monitor-server.js` 有 dashboard，但**只展示**、不发告警
- DeepSeek 余额烧到 -¥1.22 才在用户主动登 dashboard 时发现
- `pm2` errored 51 次也没报警

**修复建议**（Wave 4）：

最简：cron + 邮件
```bash
# crontab
*/5 * * * * /usr/bin/curl -sf http://127.0.0.1:3000/api/health | grep '"status":"ok"' \
            || echo "bookofelon health check failed at $(date)" \
               | mail -s "[BOE ALERT] health check fail" you@example.com
```

更好：feishu/dingtalk webhook、阿里云云监控、UptimeRobot 免费档接 `/api/health`。

DeepSeek cost：每天 cron 拉 DeepSeek balance API → 余额低于阈值发报警。

**估算**：1.5 小时（health check cron + DeepSeek 余额监控）。

### 4.5 备份策略需要测演练

**现状**：
- ✅ `scripts/ops/backup-db.js` 写得很好（用 SQLite `.backup()` API，热备 + gzip + 轮转）
- ✅ DEPLOY.md §6.5 提到 cron + rsync + 灾难演练
- ❌ **没人真演练过**

DEPLOY.md §6.5.5 自己写：

> "没演练过的备份 = 没备份。"

但目前不知道**最近一次成功恢复**演练是什么时候 —— 可能从来没跑过。

**修复建议**：每月 1 次定期演练 + 演练日志（`docs/runbooks/dr-drill-log.md`）。

### 4.6 ✅ 亮点

- **`scripts/deploy.sh` 是高质量产物**：10 步流水线、颜色输出、错误兜底、回滚提示完整、不依赖 jq（用 grep 抽 health JSON 字段，跨环境兼容）
- **PM2 配置克制**：单实例 + memory restart 300M + monitor 200M，对个人项目合理
- **健康检查三层**：`/health`（liveness） + `/ready`（readiness） + `/api/health`（含 DB 计数 + LLM 状态）
- **`db/schema.sql`** 用了 `journal_mode=WAL` + `synchronous=NORMAL` —— 对 SQLite 单写多读场景是最优
- **WAL 模式** + 热备份 + gzip + 轮转 → 备份策略框架完备（差最后一步：异地 + 演练）

---

## 5. 维度【安全 / 成本】— 6/10

### 5.1 头号问题：cost guardrails 至今没上 → DeepSeek 烧 ¥100

**证据**（来自 transcript + git log）：

- 4/27 用户截图显示 DeepSeek 账户余额 -¥1.22，3 天烧完 ¥100
- 当前 `.env` 里 `DEEPSEEK_API_KEY=disabled_due_to_abuse`（临时止血）
- `server.js` 当前 cost 控制：
  - `CHAT_RATE_LIMIT_MAX_REQUESTS=8` per `CHAT_RATE_LIMIT_WINDOW_MS=60000`（8 req/min/IP）
  - `DEEPSEEK_MAX_TOKENS=700`（默认）
  - `CHAT_BURST_MAX_REQUESTS=3` per 10s
  - `CIRCUIT_BREAKER_FAIL_THRESHOLD=5`
  - **没有：单 IP 每日 token 配额、全站每日总额熔断、单条用户输入字符上限（仅 2500）、未登录用户每日 chat 次数限制**

**为什么 8 req/min 不够**：
- 攻击者切换 IP（家庭宽带 / 代理池）就能绕过
- 没有跨请求的 token 累计
- 没有按 user_id / device fingerprint 的限速

**修复建议**（建议作为 Wave 1 P0 一部分）：

```
A. 单 IP 每日 token 配额
   实现：内存（重启重置） or SQLite 表 ip_daily_token_usage
   阈值：50,000 token/IP/day（合法用户上限远低于此）
   超额：429 + Retry-After: <next_midnight - now>

B. 全站每日 total token 熔断
   实现：原子计数器（SQLite UPSERT 或内存）
   阈值：DAILY_TOTAL_TOKEN_BUDGET=2,000,000（≈ ¥10/天硬上限）
   超额：自动切 fallback，logEvent('warning', 'daily_token_budget_exceeded')
   恢复：跨过 UTC 0 点重置

C. max_tokens 收紧到 400（默认 700 太奢侈）
   一行改 .env

D. 单条 message content 上限从 2500 → 800
   多个 message：history slice(-10) 已有，再加 totalChars 上限 5000

E. 未登录用户每日 chat 次数
   阈值：20 次/anon_session_id/day
   超额：提示登录

F. SSE / streaming 未来再说，先用 batch
```

实施估算：3-4 小时（含数据库 schema + 测试）。

### 5.2 `.env` 仍在 web 服务 cwd（CSO #7 没修）

**证据**：CSO 4/14 报告 Finding #7 标记 MEDIUM，建议把 secrets 从 `.env` 文件迁到系统 env vars 或 `/etc/book-of-elon/.env`。

**当前状态**：

```bash
$ ls -la /root/skill_The_book_of_Elon/.env
-rw-r--r-- 1 root root 871 Apr 19 13:17 /root/skill_The_book_of_Elon/.env
```

`.env` 还在仓库根目录，权限 644（!）。CSO #1（静态路由白名单）已修，所以不能再通过 HTTP 访问 `/.env`，但纵深防御还是 missing：
- `.env` 权限 644 = 同机器其他用户能读
- 一旦 PM2 跑非 root 用户的设计被引入（CSO #4 改 Dockerfile 已经 USER boe），权限矛盾会出现
- 备份脚本的 `cp -r` 类操作会把 `.env` 一起带走

**修复建议**：
1. **最低限度（5 分钟）**：`chmod 600 .env`
2. **推荐（30 分钟）**：迁到 `/etc/book-of-elon/.env`，pm2 启动时用 `--env-file` 或 `bash -c "set -a; source /etc/book-of-elon/.env; set +a; node server.js"`
3. **理想（1 小时）**：迁到 systemd `Environment=` 块（如果换 systemd 托管）或 PM2 `ecosystem.config.js` 的 `env_production:`，文件本身只在 deploy 时存在

### 5.3 PII 数据查看流程繁琐

**证据**：今天为了让用户看 224 条聊天记录，折腾路径：

1. 写 `scripts/export-admin-snapshot.js` 生成 HTML（PII 脱敏）→ Workbench 下载失败
2. 改 DB path autodetect → 推送 git → 用户 git pull → better-sqlite3 ABI mismatch
3. 在 `/tmp/snap` 临时装 better-sqlite3 → 终于跑通
4. 用户问 "怎么这么笨能不能临时网站给我看" → 提议 IP 白名单 + token URL
5. 用户继续追问 → 最终用 `scripts/admin-report.js`（纯文本到终端 + less 分页）→ 还在路上（Workbench powerful + 中途切 admin/root）

**这反映什么**：
- 没有"管理员视角看后台数据" 的标准工具
- 临时脚本生成机制（admin-report / export-admin-snapshot）每次都要重新发明
- Workbench 文件传输不可靠 → 没 plan B

**修复建议**：

把 `scripts/tools/admin-report.js` 当作正式工具固化：
- 加更多输出模式：`--filter-user=<id>`、`--since=<date>`、`--format=text|json|markdown`
- 在 `docs/runbooks/data-snapshot-pii-safe.md` 写标准用法
- 提到"Workbench 下载失败时怎么办"（git pull 路径已被验证可靠）

**估算**：1 小时。

### 5.4 ✅ 亮点（CSO 已修项目录）

| CSO Finding | 严重度 | 状态 | git commit |
|---|---|---|---|
| #1 静态路由暴露整个 repo | 🔥 CRITICAL | ✅ 已修 | `baf5362 security: 堵住任意文件读取 + SMS prod fail-fast (CSO P0 #1 #3)` |
| #2 客户端可覆盖 system prompt | HIGH | ✅ 已修 | `0f2d79a security: 修复剩余 CSO 审计项 #2/#4/#5/#6 + 两个新发现的 LOW` |
| #3 SMS prod fail-fast 缺失 | HIGH | ✅ 已修 | `baf5362` |
| #4 Dockerfile 以 root + npm install | HIGH | ✅ 已修 | `0f2d79a` |
| #5 Nginx 模板缺 HTTPS / 安全头 / deny | MEDIUM | ✅ 已修 | `0f2d79a` |
| #6 备份文件权限 644 | MEDIUM | ✅ 已修 | `0f2d79a` |
| #7 `.env` 在 web cwd | MEDIUM | ⏳ 未修 | — |

**还在的（应该追加修复）**：
- CSO #7：`.env` 迁到 `/etc/book-of-elon/.env`（见 §5.2）
- CSO 自身 follow-ups：建议 30 天再跑一次 `/cso` 看回归

### 5.5 未来威胁（不在当前清单，但建议关注）

- **多账户 abuse**：当前一个手机号每天 10 条短信（`sms-throttle.js`），但攻击者可批量手机号。建议加"新账号 24h 内 chat 限速"
- **CDN 缓存毒化**：如果未来上 CDN，需要校核 cache control header
- **DeepSeek 出问题时的连锁**：当前 fallback 是本地知识，但 fallback 期间用户体验骤降，没有"通知"机制告诉用户

---

## 6. Bonus: 心智负担信号（你没勾，但数据指向这里）

虽然你勾的是【代码 / 文件 / 文档 / 运维 / 安全】没勾【心智负担】，但下面这些信号都指向"项目缺一个 caretaker"：

### 6.1 Commit message 风格混乱

近 30 个 commit 抽样：

```
1ec54ad tools: add scripts/admin-report.js for terminal text report (PII masked)   ← 英文 conventional
fd71650 fix snapshot db path autodetect                                            ← 无 prefix 全英文
8cf67f9 tools: 添加离线 admin snapshot HTML 导出脚本（PII 脱敏 + 零网络）          ← 中文 conventional
0f2d79a security: 修复剩余 CSO 审计项 #2/#4/#5/#6 + 两个新发现的 LOW             ← 中文 conventional
baf5362 security: 堵住任意文件读取 + SMS prod fail-fast (CSO P0 #1 #3)            ← 混合
b11164f fix(auth): 停止 claim 匿名 session — 匿名数据不归户（产品决策）           ← 中文 conventional + scope
67108dc feat(modal-design): premium glass modal — strong dark backdrop, panel ... ← 英文 conventional + scope
0fcecb0 fix(memory-modal): drop pale-blue gradient on .memory-northstar ...      ← 英文 conventional + scope
e0e4bc5 撤回 localStorage → server 自动同步（行业惯例：登录前不存）              ← 无 prefix 全中文
422e942 P0 fixes: 持久化原子性 + 启动迁移 + OTP CSPRNG + localStorage 导入       ← 自创 prefix
2217881 feat: account system + cross-session memory + production hardening      ← 英文 conventional
1eb5620 Simplify monitor dashboard language                                      ← 无 prefix 全英文
792b590 Require monitor auth before startup                                      ← 无 prefix 全英文
1e02ad8 Polish mobile chat UX and add monitor dashboard                          ← 无 prefix 全英文
0783b2c Initial Book of Elon site baseline                                       ← 无 prefix
```

**判定**：3 种风格混在一起。没有 commit message convention。

**修复建议**：定一个简单约定（不需要严格 conventional commits）：
```
<type>: <message>
type ∈ { feat, fix, refactor, docs, test, ops, security, chore }
message: 中文或英文一致即可（建议中文为主，技术名词英文）
```

### 6.2 中文 commit 乱码（永久无法恢复）

git log 输出里：

```
8cf67f9 tools: 娣诲姞绂荤嚎 admin snapshot HTML 瀵煎嚭鑴氭湰锛圥II 鑴辨晱 + 闆剁鍙ｏ級
a1297fc ops: scripts/cleanup-claimed-sessions.js 鈥?涓€娆℃€ф竻鐞嗗巻鍙茶 claim 鐨?session
67108dc feat(modal-design): premium glass modal 鈥?strong dark backdrop, panel depth, blue glow halo
```

中文已经被 PowerShell + GBK + UTF-8 转码搞坏。**无法恢复**（git 历史不能改写而不影响下游 clone）。

**修复建议**：

1. 设置 git core.quotePath = false（让 git 输出 UTF-8）：
   ```bash
   git config --global core.quotePath false
   ```
2. PowerShell 强制 UTF-8：
   ```powershell
   $OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
   ```
3. 未来 commit message 优先英文（避免再出乱码）

### 6.3 全在 main 上推

```bash
$ git branch -a
* main
  remotes/origin/main
```

没有 feature branch、没有 PR review、没有 CI check。

**修复建议**：建立分支 + PR 流程（哪怕一个人也走）：
- 改东西先 `git checkout -b fix/xxx`
- push → 在 GitHub 自己开 PR
- merge 前看一遍 diff（catch 自己的笔误）

GitHub Actions 加最简 CI（`npm run preflight` + `npm run db:smoke`）。

**估算**：30 分钟（设置 + 第一个 PR 走通流程）。

### 6.4 0 个 refactor commit / 60 天

近 30 commit grep `refactor` → 0 hit。

**判定**：项目处于**永远在加新东西 + 修 bug** 的状态，没有"停下来整理一下"的时间。这是**心智负担堆积的根本机制**。

本审计文档 + Wave 2 的执行就是第一次主动 refactor。

### 6.5 临时脚本生成机制

近 7 天新增的脚本：

```
scripts/admin-report.js              (今天加，1ec54ad)
scripts/export-admin-snapshot.js     (3 天前加，8cf67f9)
scripts/cleanup-claimed-sessions.js  (~10 天前加)
```

**判定**：每次需要看数据 / 救火，就在 `scripts/` 里加一个 `.js` —— 但**没有删除机制 + 没有归类**。一年后 `scripts/` 会有 50 个文件，不知道哪些还在用。

**修复建议**：
- §2.5 已经把 scripts 拆 `ops/` `tools/` `calibration/`
- 在 `tools/` 下加 `README.md`，每个文件一行说明（用途 + 上次成功跑的日期）
- 半年清理一次（git log 看哪些 6 个月没 touch 过 → 移到 `archive/` 或删）

---

## 7. Remediation Roadmap

### 7.1 优先级一览

| 编号 | 优先级 | 维度 | 工作 | 工时 | 依赖 |
|---|---|---|---|---|---|
| **R-01** | 🔴 P0 | 安全/成本 | 实施 cost guardrails（A/B/C/D/E） | 3-4 h | — |
| **R-02** | 🔴 P0 | 安全/成本 | 恢复 DEEPSEEK_API_KEY（依赖 R-01 完成） | 5 min | R-01 |
| **R-03** | 🟡 P1 | 安全 | `.env` 迁到 `/etc/book-of-elon/.env` + `chmod 600` | 30 min | — |
| **R-04** | 🟡 P1 | 文件/目录 | 删 working tree 里的 `output.md` | 5 min | — |
| **R-05** | 🟡 P1 | 文件/目录 | 重组 `scripts/` 为 `ops/` / `tools/` / `calibration/` | 1 h | — |
| **R-06** | 🟡 P1 | 文件/目录 | `book-source.js` / `card-data.js` / `knowledge-base.js` 转 JSON 移到 `data/` | 45 min | — |
| **R-07** | 🟡 P1 | 文件/目录 | 把 `reply-engine.js` `model-client.js` 移到 `services/` | 30 min | — |
| **R-08** | 🟡 P1 | 文件/目录 | 测试 smoke 移到 `tests/` | 1 h | R-05 |
| **R-09** | 🟡 P1 | 文档 | 合并 3 份 DEPLOY 文档为 `docs/DEPLOYMENT.md` | 2 h | — |
| **R-10** | 🟡 P1 | 文档 | 6 份 .md 移到 `docs/`（OBSERVABILITY、launch-plan、reply-strategy、prompt-ab、reply-calib-output 删除） | 30 min | — |
| **R-11** | 🟡 P1 | 文档 | 写 `docs/ARCHITECTURE.md`（从 CLAUDE.md §3 抽出 + 加 mermaid） | 1 h | — |
| **R-12** | 🟡 P1 | 文档 | 写 `docs/runbooks/` × 5 份 | 1.5 h | — |
| **R-13** | 🟡 P1 | 文档 | `README.md` 精简到 ~3 KB | 30 min | R-09, R-11 |
| **R-14** | 🟡 P1 | 部署/运维 | 健康检查 cron + DeepSeek 余额监控 | 1.5 h | — |
| **R-15** | 🟡 P1 | 部署/运维 | `.gitignore` 补强 | 5 min | — |
| **R-16** | 🟠 P2 | 部署/运维 | 决策 Docker 路径：保留+加 CI 或删除 | 1 h | — |
| **R-17** | 🟠 P2 | 部署/运维 | git config + commit message convention（写到 CONTRIBUTING.md） | 30 min | — |
| **R-18** | 🟠 P2 | 部署/运维 | 加 GitHub Actions CI（preflight + smoke） | 1 h | R-17 |
| **R-19** | 🟠 P2 | 部署/运维 | staging 环境（同机器子域名） | 4 h | R-18 |
| **R-20** | 🟢 P3 | 代码/架构 | `server.js` 拆解为 `routes/` × 5 + `services/` × 3 + `middleware/` | 1-2 d | R-08（测试结构稳定后） |
| **R-21** | 🟢 P3 | 部署/运维 | DR 演练（恢复一次备份） | 1 h | — |
| **R-22** | 🟢 P3 | 安全 | 30 天后再跑 `/cso` 看回归 | 30 min | — |

### 7.2 推荐执行波次

#### Wave 1 — 止血（4-6 小时，建议今晚或明天）

```
R-01 cost guardrails       3-4 h
R-02 恢复 LLM key            5 min
R-04 删测试输出 .md          5 min
R-15 .gitignore 补强        5 min
R-03 .env 加固              30 min
```

**完成后**：钱不再烧、LLM 回归、根目录清理掉两个 26.9 KB 的输出产物。

#### Wave 2 — 秩序重建（4-6 小时，建议本周）

```
R-05 scripts/ 重组          1 h
R-06 数据移 data/JSON       45 min
R-07 reply 移 services/     30 min
R-08 tests/ 重组            1 h
R-10 .md 移 docs/           30 min
R-09 合 DEPLOY 三份         2 h
R-11 ARCHITECTURE.md        1 h
R-12 runbooks × 5           1.5 h
R-13 README 精简            30 min
```

**完成后**：根目录从 35 个文件减到 ~14 个；docs/ 从空变成结构化；scripts/ 分组；3 份 DEPLOY 合 1。心智负担骤降。

#### Wave 3 — 长期治理（半天，可选）

```
R-16 Docker 决策            1 h
R-17 commit convention      30 min
R-18 GitHub Actions CI      1 h
R-14 health/cost monitoring 1.5 h
R-21 DR 演练                1 h
R-22 CSO 回归               30 min
```

**完成后**：项目有了 governance（CI、commit convention、监控告警、DR）。

#### Wave 4 — 代码大手术（1-2 天，需要专门时间）

```
R-19 staging 环境           4 h
R-20 server.js 拆解         1-2 d
```

**完成后**：可维护性达到 production-grade。

### 7.3 总工时估算

| Wave | 工时 | 心智负担 ↓ |
|---|---|---|
| Wave 1 | 4-6 h | ★★★★ |
| Wave 2 | 4-6 h | ★★★★★ |
| Wave 3 | 5-6 h | ★★ |
| Wave 4 | 1.5-2 d | ★★★ |
| **合计** | **~3-4 个工作日** | |

### 7.4 不在本审计范围（明确不做）

- ❌ 引入 TypeScript / React / 任何前端框架（CLAUDE.md 明确决策保持原生 JS）
- ❌ Redis / Docker Compose / k8s（当前规模不需要）
- ❌ 微服务拆分（单进程对当前规模合理）
- ❌ 让 import-local-session 接口复活（CLAUDE.md §4.4 明确产品决策）

---

## 8. Appendix

### 8.1 完整文件清单（89 个，gitignored 排除）

```
[root × 22 files]
  README.md, CLAUDE.md
  package.json, package-lock.json
  .env.example, .env.production.example, .gitignore, .dockerignore
  Dockerfile, ecosystem.config.js, nginx.book-of-elon.conf.example
  server.js, monitor-server.js
  preflight-check.js
  index.html, styles.css, app.js, auth-ui.js
  reply-engine.js, model-client.js, reply-calibration.js
  deepseek-eval.js, deepseek-smoke-test.js
  knowledge-base.js, card-data.js, book-source.js
  DEPLOY.md, DEPLOY_RUNBOOK.md, DEPLOY_CHECKLIST.md
  OBSERVABILITY.md, launch-readiness-plan.md, reply-test-strategy.md, prompt-ab-report.md
  reply-test-set.json
  reply-calibration-output.md (gitignored 但 working tree 有), deepseek-eval-output.md (同)

[db × 7 files]
  schema.sql, database.js, auto-migrate.js
  sessions.js, users.js, facts.js, goals.js, sms.js

[routes × 2 files]
  auth.js, me.js

[services × 2 files]
  fact-extractor.js, system-prompt.js

[auth × 3 files]
  session.js, sms-aliyun.js, sms-sender.js

[prompts × 1 file]
  system-prompt-v2.md

[scripts × 24 files] (见 §2.3 分类)

[.gstack/security-reports × 2 files]
  2026-04-14-cso-audit.md
  2026-04-14-cso-audit.json

[docs × 0 files]    ← 注意

[data/]             ← gitignored
```

### 8.2 server.js 函数清单（80+ 函数 grep 结果）

完整清单见 §1.2 表格。Top 10 by 重要性：

```
handleChatRequest()       async, line 535   ← 主 chat 编排
persistChatTurn()         line 438          ← 原子事务
buildUpstreamMessages()   line 805          ← LLM payload 构造
requestDeepSeek()         async, line 1196  ← LLM HTTP
buildLocalFallbackReply() line 1251         ← 降级回复
consumeRateLimit()        line 1307         ← 限流
isCircuitOpen()           line 1443         ← 熔断
buildDeepHealth()         line 1462         ← /api/health
serveStaticFile()         async, line 925   ← 静态资源（含 CSO #1 修复后的白名单）
validateChatRequestSecurity()  line 1674    ← 同源 + chat token
```

### 8.3 重叠文档对比矩阵（已在 §3.1 详述，此处略）

### 8.4 引用的 git commits

| commit | 含义 |
|---|---|
| `1ec54ad` | 本审计执行时的 HEAD（admin-report.js 加完即此 commit） |
| `0f2d79a` | CSO Findings #2 #4 #5 #6 + 2 个新 LOW 修复（4/14） |
| `baf5362` | CSO Findings #1 #3 修复（任意文件读取 + SMS prod fail-fast） |
| `b11164f` | 匿名数据不归户产品决策落地 |
| `9f2e6e7` | docs/CLAUDE.md 同步那次（CLAUDE.md 创建） |
| `2217881` | 账号系统 + 跨会话记忆首次合入 |

### 8.5 引用的 CSO findings（4/14 audit）

| # | 严重度 | 主题 | 状态 |
|---|---|---|---|
| 1 | CRITICAL | 静态文件路由暴露整个 repo（含 SQLite + .env） | ✅ Fixed |
| 2 | HIGH | 客户端可任意覆盖 LLM system prompt | ✅ Fixed |
| 3 | HIGH | SMS 通道无 prod 强制（OTP 漏到 HTTP 响应） | ✅ Fixed |
| 4 | HIGH | Dockerfile root + npm install + data/ in image | ✅ Fixed |
| 5 | MEDIUM | Nginx 示例缺 HTTPS / 安全头 / deny block | ✅ Fixed |
| 6 | MEDIUM | 备份文件权限 644 | ✅ Fixed |
| 7 | MEDIUM | `.env` 在 web 服务 cwd | ⏳ Open |

### 8.6 引用的 transcript 关键节点（今天 1 小时救火）

| 时间 | 事件 | 文件 |
|---|---|---|
| T+0 | 用户："被别人刷爆了吗 3 天刷了 100 块" + DeepSeek 控制台截图 | — |
| T+10 | 决策：disable DEEPSEEK_API_KEY 临时止血 | `.env` |
| T+15 | 用户："把后台对话数据调出来我看看" | — |
| T+20 | 写 `scripts/export-admin-snapshot.js` (HTML, PII masked) | `8cf67f9` |
| T+30 | better-sqlite3 ABI mismatch → `/tmp/snap` 临时装新 better-sqlite3 → 跑通 | — |
| T+40 | 用户尝试 Workbench 下载 `admin-snapshot.html` → OSS internal endpoint 不通失败 | — |
| T+45 | 用户："还有更好的方法吗 这个方法怎么感觉这么笨呢 你就不能链接服务器吗" | — |
| T+50 | 写 `scripts/admin-report.js`（纯文本到终端 + less 分页） | `1ec54ad` |
| T+55 | 用户尝试 heredoc 粘贴 → Workbench 终端吞行失败 | — |
| T+60 | 改用 git pull 路径 → 但用户在 admin 用户下、不能访问 /root/... | — |
| T+62 | 切 root → cd 后 prompt 显示在 ~ 而不是项目目录（多次粘贴 sudo -i 嵌套） | — |
| T+65 | 用户："我现在觉得这个项目非常非常混乱  你用 superpower 完整且详细的审视一下这个项目" | （触发本审计） |

---

## 9. 评审与下一步

### 9.1 本文档自检清单（按 brainstorming SKILL §"Spec Self-Review"）

- [x] **Placeholder scan**：搜索 `TBD` / `TODO` / `???` —— 0 个未填项
- [x] **Internal consistency**：5 个维度评分总和（5+4+5+4+6=24，平均 4.8）与 §0 报告一致
- [x] **Scope check**：聚焦在用户勾选的 5 维度 + Bonus，没扩散到产品/git/心智负担的具体方案设计（仅提示）
- [x] **Ambiguity check**：每条修复建议都给了具体文件路径 / 命令 / 工时

### 9.2 给用户的请求

请你 review 这份文档，重点确认：

1. **5 维度评分**是否符合你的实际感受（哪个偏高/偏低？）
2. **R-01 ~ R-22 修复清单**有没有遗漏的痛点
3. **波次执行顺序**（Wave 1 → 2 → 3 → 4）是否合理
4. **不在范围**（§7.4）的明确不做项是否同意

review 后告诉我：

- **A. 立即开始 Wave 1**（cost guardrails + 文件清理止血，4-6 小时）
- **B. 先看更详细的某一项**（指定 R-XX 编号，我深挖）
- **C. 调整路线图**（增删改 R-01..R-22）
- **D. 直接全部执行**（Wave 1 → 4，分多次提交，每次完成给你 review 节点）

---

**审计完成时间**：2026-04-27
**审计员**：Claude (Cursor IDE, Opus 4.7)
**HEAD**：`1ec54ad`
**下一步**：等待用户 review 与决策
