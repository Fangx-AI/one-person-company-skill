# Contributing — Book of Elon

> 本仓库是单人/小团队 production 服务（DeepSeek 聊天 + SQLite 持久化 + pm2 直起 Node）。  
> 不走 PR review 流程时这份文档也是给"30 天后的你"看的——所以约定要紧。

---

## 1. 开发流程

```bash
# 拉新
git fetch --all --prune
git pull --ff-only main

# 起本地（degraded 模式，不需要真的 DEEPSEEK_API_KEY）
node server.js

# 离线 smoke（不需要服务跑起来）
npm run cost:smoke
npm run prompt:smoke
npm run smoke:db

# 在线 smoke（必须先 node server.js）
npm run static:smoke
npm run smoke:auth
npm run smoke:persistence
npm run smoke:northstar

# 提交前必跑
node preflight-check.js --allow-degraded
```

**任何 commit 之前**：preflight + 至少一个 smoke 必须绿。CI（`.github/workflows/ci.yml`）也会跑，但本地先跑可以省掉 push-revert 的丢人时刻。

---

## 2. 分支策略

- `main` — 生产，pm2 直接拉这个分支
- 单人开发可以直接 commit 到 `main`，但**每个 commit 必须自包含**（feat/fix/refactor 不混在一个 commit）
- 大改用 feature branch（`feat/xxx`），merge 时用 `--ff-only` 避免 merge commit 污染历史

---

## 3. Commit 规范（Conventional Commits 简化版）

```
<type>(<scope>): <subject>

[body — 解释为什么，不解释做了什么]

[footer — 关联 R-xx audit 项 / breaking change]
```

### type（必填）

| type | 用途 |
|------|------|
| `feat` | 新功能（用户能感知的） |
| `fix` | bug 修复（含线上 incident 修复） |
| `refactor` | 重构，行为不变 |
| `perf` | 性能优化 |
| `docs` | 仅文档 |
| `test` | 仅测试 |
| `chore` | 构建/依赖/工具链（`package-lock` 更新等） |
| `ops` | 运维相关（cron、deploy 脚本、pm2 配置） |
| `security` | 安全相关（CVE 修复、权限收紧、密钥轮换） |

### scope（可选但强烈推荐）

`server` / `auth` / `db` / `cost` / `frontend` / `ci` / `docs` / `runbooks` …  
用 audit doc 里的目录名或维度名。

### subject（必填）

- 中英文都行，但**祈使句**（"add"/"fix"/"加"/"修"），不是过去式
- ≤ 60 字符（GitHub UI 截断阈值）

### Body（可选）

- 折行 72 字符
- 说**为什么**这个改动是必要的，**不要**重复 diff 里能看到的"做了什么"
- 关联 audit 项时写明：`Fixes R-23.` / `Part of R-12.`

### 示例

✅ 好：

```
fix(server): R-23 把 book-source.js 加进 STATIC_FILE_ALLOW

线上 361KB 书源文件在 prod 静默 404，前端走本地降级
逻辑没炸但匹配质量明显下降。Phase C-1 的精确修复。

Fixes R-23.
```

```
ops(cron): R-14 加每分钟健康检查 + 09:00 余额日报

健康检查写到 /var/log/book-of-elon/health.log，连续 3 次
非 ok 触发 pm2 reload。余额日报调 DeepSeek /user/balance
+ admin-report.js，PII 全部 mask。

Part of R-14.
```

❌ 差（实际历史里有过的）：

```
update                                    # 太空，不知道改了啥
fix bug                                   # 哪个 bug
WIP                                       # 进 main 永远不该出现
chore: 各种修改                           # 一个 commit 混 feat+fix+docs
```

---

## 4. 文件结构红线

> 这些规矩是 Wave 1/2/3 重组后的产物，破坏它们等于回到混乱状态。

| 位置 | 内容 | 红线 |
|------|------|------|
| repo 根 | server / pm2 / package.json / 顶级文档 | **不要**再放 `*-calibration.js` / `*-eval.js` / 临时脚本 |
| `web/` | 浏览器端文件 | server.js 通过 `webRoot` 静态服务这里。**不要**在这里 require Node 模块 |
| `services/` | 后端纯逻辑模块 | 不依赖 HTTP 上下文，单测能跑 |
| `routes/` | Express 风格路由 | 只编排，逻辑下沉到 services |
| `db/` | better-sqlite3 封装 | 一个文件一个域（users / sessions / messages…） |
| `auth/` | 鉴权 | 不导出 SQL 字符串，只导出函数 |
| `tests/smoke/` | 离线 smoke | 一个文件 < 200 行，自包含，输出"Total: N passed, M failed" |
| `tests/e2e/` | 跑真 server 的端到端 | `SMOKE_BASE` 决定指哪 |
| `tests/calibration/` | reply / deepseek 校准 + 测试集 + 输出物 | 输出物 `*-latest.md` 在 .gitignore |
| `scripts/ops/` | 运维脚本（deploy / backup / cron） | shell 或 node，必须有 `set -euo pipefail`（shell）/ exit code 正确 |
| `scripts/tools/` | 一次性工具（admin-report / data extract） | 加在 README 工具表里 |
| `docs/runbooks/` | 事故 / 操作 runbook | 固定结构：症状 / 第一动作 / 根因 / 修复 / 事后 |
| `docs/superpowers/` | audit + plan + retro | audit 是事实快照，plan 是开工许可 |

---

## 5. 安全 / 密钥红线

- **永远不要** `git add .env`（已被 .gitignore 兜住，但人脑也要兜）
- `.env` 在服务器永远 `chmod 600`，修改后跑 `scripts/ops/check-env-perms.sh` 确认
- DeepSeek key 泄了走 `docs/runbooks/incident-cost-spike.md` 的 rotate 流程
- 任何 commit 加了类似 `sk-` / `Bearer ` / `password=` 字面量的东西，**revert 然后改 hashed**
- pre-push 看一眼 `git diff main..HEAD --stat`，超过 50 个文件多半是误提交（除了批量 git mv）

---

## 6. Review checklist（自审 / 互审都用）

提交前对着问自己：

- [ ] preflight 绿
- [ ] 至少一个相关 smoke 绿
- [ ] commit message 有 type + scope + 关联 R-xx
- [ ] 没碰 `.env` / `data/*.db` / `data/backups/`
- [ ] 改了 `server.js` 的静态文件白名单 → 跑了 `static:smoke`
- [ ] 改了路由 → 跑了 `auth:smoke` 或 `persist:smoke`
- [ ] 改了前端 JS → `node --check web/*.js` + 至少 reload 一次浏览器
- [ ] 改了 `package.json` → 跑了 `npm install` 让 lock 同步
- [ ] 加了文档 → 落到 `docs/` 而不是 repo 根

---

## 7. 紧急 hot-fix 流程（凌晨 3 点）

1. `git checkout -b hotfix/<issue> origin/main`
2. 改 + 本地 preflight
3. `git commit -m "fix(<scope>): <subject>"` 关联事故 runbook
4. `git push origin hotfix/<issue>`
5. 在服务器 root：`cd /root/skill_The_book_of_Elon && git fetch && git checkout hotfix/<issue> && pm2 reload book-of-elon`
6. 验证生产 `/api/health` 绿
7. 第二天 merge 回 main，删 hotfix 分支
8. 写事故复盘进 `docs/runbooks/`

---

> 最后一条：**长期主义**。这份文档每次破规都该被 update，而不是被忽略。
