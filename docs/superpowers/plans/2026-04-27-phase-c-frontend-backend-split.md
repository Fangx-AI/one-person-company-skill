# Phase C 计划：前后端物理分离 + 数据资产化

- **作者**：Claude（superpowers framework）
- **日期**：2026-04-27
- **状态**：✅ 已完成。C-1 = `b8831f7`（前后端隔离 + R-23 修 404 bug）；C-2 = `26b3ea0`（数据 JSON 化 + async bootstrap）。生产部署验证通过。
- **覆盖审计项**：R-04 / R-06 / R-23（新发现）/ R-24（新发现）
- **关联**：`docs/superpowers/audits/2026-04-27-project-audit.md`

---

## 1. 背景与触发

Wave 2 Phase A（文档）/ Phase B（脚本与测试目录）已上线并验证通过。原审计 Phase C
计划在动手前发现两个**关键架构假设错误**，加上一处隐藏生产 bug，必须修订：

| 错误 / 发现 | 真相 | 处理 |
|---|---|---|
| R-06 写"`reply-engine.js` / `model-client.js` 移到 `services/`" | 这两个是**浏览器端 `<script>` 加载文件**，不是 Node 模块 | 重定义 R-06 为「前后端物理目录分离」 |
| R-04 写"`book-source.js` / `card-data.js` / `knowledge-base.js` 转 JSON 到 `data/`" | `knowledge-base.js` 是纯逻辑函数库（`buildKnowledgeBase` / `searchKnowledgeBase` / `normalizeSearchText` 等），不是数据 | R-04 范围收窄：只把 `book-source.js` + `card-data.js` 转 JSON；`knowledge-base.js` 保持 `.js` |
| 新发现 R-23：`STATIC_FILE_ALLOW` 白名单**没有 `/book-source.js`** | 生产环境 `GET /book-source.js → 404`（已验证），361KB 知识源静默失效，前端 fallback 到 cards-only 模式 | C-1 顺手修白名单 |
| 新发现 R-24：前端文件跟后端代码**全混在仓库根目录** | 9 个 frontend 文件（`index.html` / `styles.css` / `app.js` / `auth-ui.js` / `card-data.js` / `knowledge-base.js` / `book-source.js` / `model-client.js` / `reply-engine.js`）和 `server.js` / `services/` / `routes/` / `db/` / `auth/` 同级 | C-1 建 `web/` 目录全部搬走 |

## 2. 目标

1. **前后端物理隔离**：所有浏览器端文件归 `web/`，`server.js` 静态根改为 `path.join(projectRoot, "web")`，URL 不变。
2. **修生产 bug**：`/book-source.js` 加进白名单，让 361KB 知识源真正可用。
3. **数据资产化**：`book-source.js` (361KB) / `card-data.js` (55KB) 转为 JSON 资产，前端 `fetch` 异步加载，`app.js` 启动流程改为 async bootstrap。
4. **不破坏 URL**：所有原 URL 保持兼容（`/index.html`、`/app.js`、`/styles.css` 等）；新增 `/book-source.json`、`/cards.json`。
5. **完整验收**：local smoke + headless DOM + e2e + 服务器部署后 health + 抽样 curl + 浏览器实测。

## 3. 不在范围内（明确不做）

- 不引入构建工具（webpack / vite / esbuild）。前端继续 vanilla JS，零编译。
- 不重写 `knowledge-base.js`（它是逻辑，保持函数库形态）。
- 不动 `data/` 目录（这是 server-side analytics + 用户库的 SQLite 落盘点，与"前端 data 资产"是两件事）。
- 不动 cron / pm2 / nginx 反代逻辑。

## 4. 全局符号依赖（关键约束）

`grep` 出的全局变量依赖图（决定 async bootstrap 必须如何处理 globals）：

| 全局符号 | 定义位置 | 使用位置 |
|---|---|---|
| `var cards` | `card-data.js:1` | `app.js`, `knowledge-base.js`, `tests/e2e/jsdom-click.js` |
| `var idToCard` | `card-data.js:1085` | `app.js`(9 处), `reply-engine.js`(2 处), `knowledge-base.js`(1 处) |
| `function buildKnowledgeBase` | `knowledge-base.js:1` | `app.js:1`, `app.js:6`, `app.js:15` |
| `window.BOOK_OF_ELON_SOURCE` | `book-source.js:1` | `app.js:5`, `app.js:14` |
| `window.BOOK_OF_ELON_KB` | `app.js:2` | （目前没人读，但是 promise hook） |

**关键**：转 JSON 后 `cards` / `idToCard` 不再被 sync `<script>` 顶层赋值，必须在 async bootstrap 内显式 `window.cards = ...; window.idToCard = ...;`，否则 `reply-engine.js` 等会拿到 `undefined`。

## 5. 分阶段交付

### Phase C-1：前后端目录分离 + 修 R-23 bug（保守，URL 不变）

| 步骤 | 内容 |
|---|---|
| C1-mv | `web/` 目录创建；`git mv` 9 个前端文件进去：`index.html`, `styles.css`, `app.js`, `auth-ui.js`, `card-data.js`, `knowledge-base.js`, `book-source.js`, `model-client.js`, `reply-engine.js` |
| C1-server | `server.js`：`webRoot = path.join(projectRoot, "web")`；`serveStaticFile` 用 `webRoot`；`STATIC_FILE_ALLOW` 加 `/book-source.js`（修 R-23）|
| C1-infra | `Dockerfile` 验证 `COPY` 仍工作（其实 `COPY . .` 已经 cover）；`.dockerignore` 不变；`nginx.example` 不变（纯反代）；`tests/smoke/static-security.js` 加 `/book-source.js` 进 200 名单（之前是 deny，现在改对了）|
| C1-verify | local: `node server.js` + `curl -I` 9 个 URL 全 200；`npm run static:smoke`；headless DOM 启动无 console error |
| C1-ship | commit (atomic)、push、SSH 服务器 git pull + pm2 reload + 验证 `/api/health` + `curl -I /book-source.js` 200 |

**Phase C-1 风险**：低。URL 全不变，逻辑不变，只换静态根目录。最大风险点是 `serveStaticFile` 拼路径，单元测多个 path 即可。

### Phase C-2：数据资产化（R-04，async bootstrap）

| 步骤 | 内容 |
|---|---|
| C2-extract | 用 Node 脚本从 `web/book-source.js`（`window.X = {...}`）抽出 JSON → `web/book-source.json`；从 `web/card-data.js`（`var cards = [...]; var idToCard = ...`）抽出 cards 数组 → `web/cards.json` |
| C2-app | 重写 `web/app.js` 顶部为 `async function bootstrap()`：`fetch('./cards.json')` → `window.cards` / `window.idToCard` → `buildKnowledgeBase(...)` → `render()` → 后台 `loadBookSourceAsync()` 也改 `fetch('./book-source.json')`；HTML 移除 `<script src="card-data.js">` 和 `book-source.js` 那个动态 inject |
| C2-allow | `STATIC_FILE_ALLOW`：移除 `/card-data.js` 和 `/book-source.js`；新增 `/book-source.json` 和 `/cards.json`；删除 `web/card-data.js` 和 `web/book-source.js`（已归档到 git history） |
| C2-verify | local: `npm run static:smoke`；启服务后 `curl /cards.json` / `curl /book-source.json` 200；headless DOM 验证 `window.cards.length === 11`、`window.BOOK_OF_ELON_SOURCE.chapter_count === 118`；e2e `tests/e2e/full-flow.js` 通 |
| C2-ship | commit、push、服务器 git pull + reload + 抽样验证 |

**Phase C-2 风险**：中。改 `app.js` 启动流程是大动作。缓解：
1. 保留 `var knowledgeBase` 在 bootstrap 内 `window.knowledgeBase = ...`（兼容）。
2. 把所有 `cards` / `idToCard` 引用都从 module-scope 改成 `window.cards` / `window.idToCard`（grep 全替换）。
3. 写一个 `web/data-loader.js` 集中 fetch 逻辑（可选）；或者直接 inline 进 `app.js` bootstrap（更简单）。
4. 部署前在 headless 浏览器跑一次 full-flow.js 验证启动顺序。

## 6. 验收清单（每阶段都跑）

- [ ] `npm run static:smoke`
- [ ] `npm run cost:smoke`
- [ ] `npm run prompt:smoke`
- [ ] `npm run db:smoke`
- [ ] `node server.js` 后 `curl -I http://127.0.0.1:3000/index.html` → 200
- [ ] `curl -I http://127.0.0.1:3000/book-source.js` → 200（C-1 期望）/ 404（C-2 期望）
- [ ] `curl -I http://127.0.0.1:3000/cards.json` → 404（C-1 期望）/ 200（C-2 期望）
- [ ] headless DOM：`window.cards.length === 11` + `window.BOOK_OF_ELON_KB` 已构建
- [ ] 服务器：pm2 reload 后 `/api/health.status === "ok"`，30 秒内无 console error，pm2 restart count 不增

## 7. 回滚

每阶段独立 commit，`git revert <commit>` 即可回滚。Phase C-2 失败回到 C-1（URL 仍是 `/book-source.js`），影响面零。

## 8. 完成后审计文档同步

- 标记 R-04 / R-06 ✅
- 新增 R-23（`/book-source.js` 404 bug，已修）
- 新增 R-24（前后端目录耦合，已分离）
- 更新「项目架构图」section 反映 `web/` 隔离
