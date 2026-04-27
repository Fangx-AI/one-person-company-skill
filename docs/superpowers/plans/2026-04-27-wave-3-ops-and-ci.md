# Wave 3 — Ops Hardening + CI 落地

> Source: `docs/superpowers/audits/2026-04-27-project-audit.md`  
> Wave 1 (cost guardrails) ✅ Wave 2 Phase A/B/C ✅  
> 本文锁 Wave 3 范围、顺序、验收口径。

---

## 1. 目标（Why）

Wave 1 修了**短期止血**（DeepSeek 成本 + R-23 静态资源 404）。  
Wave 2 修了**中期混乱**（前后端物理分离 + 数据资产化 + scripts/tests 重组）。  
Wave 3 解决**长期可持续性**：

- **CI 兜底**——push 上去自动跑 preflight + 4 套 smoke，避免再出现 R-23 那种"本地没事、生产 404"的事故
- **运行时可观测**——cron + 健康日报，凌晨炸了能看见，DeepSeek 余额掉 80% 能告警
- **配置面收敛**——`.env` 不再以应用根 600 散养，统一进 `/etc/book-of-elon/`，pm2 用 `env_file` 注入
- **目录尾巴扫干净**——根目录还散着 5 个 calibration JS / md / json，进 `tests/calibration/`
- **runbook 补齐**——目前只有一份 incident-cost-spike，再补 4 份覆盖 deploy / rollback / db-restore / debug

---

## 2. Out of Scope（Wave 3 不做）

- R-19 staging 环境（需要单独申请 ECS，不在本批次）
- R-20 server.js 拆解（架构级重构，需要 1-2 天，独立 Wave 4）
- R-22 30 天后 `/cso` 回归（按时间触发）
- R-15 .gitignore 已在 Wave 1 完成
- R-08 tests/ 重组已在 Wave 2 Phase B 完成
- R-09/R-10/R-11/R-13 文档重组的剩余项已在 Wave 2 完成

---

## 3. 范围分阶段

### Phase A — 目录尾巴 + 提交规范（quick wins, ~1h）

**A-1 R-24: calibration 入 tests/calibration/**

```text
reply-calibration.js          → tests/calibration/reply-calibration.js
deepseek-eval.js              → tests/calibration/deepseek-eval.js
deepseek-smoke-test.js        → tests/calibration/deepseek-smoke-test.js
reply-test-set.json           → tests/calibration/reply-test-set.json
reply-calibration-output.md   → tests/calibration/output-2026-04.md（重命名+加日期）
```

副作用：
- `package.json` scripts: `test:reply` / `test:deepseek` / `smoke:chat` 路径更新
- 这三个 CLI 自身用 `__dirname` 算 `webRoot`，搬位置后 `webRoot` 还要往上回退一级，需要改

**A-2 R-17: CONTRIBUTING.md + commit convention**

落 conventional commits 简化版：
```
<type>[scope]: <subject>

types: feat, fix, docs, refactor, perf, test, chore, ops, security
```
配合 `git config commit.template .gitmessage`（可选）。

---

### Phase B — CI 兜底（核心，~1.5h）

**B-1 R-18: GitHub Actions CI**

`.github/workflows/ci.yml`：

| job | trigger | 步骤 |
|-----|---------|------|
| `lint-and-static` | push / PR | Node 20 + `npm ci` + `node --check` 关键文件 + `node preflight-check.js --allow-degraded` |
| `unit-smoke` | push / PR | `npm run cost:smoke` + `npm run prompt:smoke`（纯内存，不需要服务） |
| `integration-smoke` | push / PR | 后台 `node server.js`（degraded 模式，无 DEEPSEEK_API_KEY）+ `npm run static:smoke` + `npm run smoke:db` + 健康检查 curl /api/health |

CI 跑 degraded 模式（`DEEPSEEK_API_KEY` 留空），这样不需要在 GH secrets 暴露真 key。  
所有 smoke 测试要能在 degraded 下绿 —— 这本身就是质量信号。

**验收**：CI 第一次跑过 → push 一个故意挂的 `STATIC_FILE_ALLOW` 删除 → CI 红 → 撤回 → 绿。

---

### Phase C — 运行时可观测（操作系统层，~2h）

**C-1 R-14: 健康检查 cron + DeepSeek 余额日报**

服务器 root crontab：
```cron
# 每分钟健康检查
* * * * * /root/skill_The_book_of_Elon/scripts/ops/health-check.sh
# 每天 09:00 余额 + 成本日报（写到 /var/log/book-of-elon/daily-report.log + 钉钉 webhook 可选）
0 9 * * * /root/skill_The_book_of_Elon/scripts/ops/daily-report.sh
```

新建文件：
- `scripts/ops/health-check.sh` — curl /api/health，非 ok 时 pm2 reload 并写 incident log
- `scripts/ops/daily-report.sh` — 调 admin-report.js + DeepSeek `/user/balance` API + 写日报

**C-2 R-03: .env 加固（不强制迁，但确认 chmod + 加文档）**

- 现状：`.env` 在 repo 根，已 `chmod 600`（Wave 1 设过）
- 决策：**不迁** `/etc/book-of-elon/`（迁了 pm2 启动脚本要全改，收益有限）
- 改为：在 `docs/runbooks/env-management.md` 锁定规则——`.env` 永远 600，永远不进 git，rotate 流程
- 加 `scripts/ops/check-env-perms.sh`，定期 cron 验证

---

### Phase D — Runbooks 补齐（~2h）

**D-1 R-12: 4 份 runbook**

| runbook | 触发 | 内容 |
|---------|------|------|
| `incident-deploy-failed.md` | pm2 reload 报错 / health 不绿 | 回滚步骤 / 看 pm2 logs / git revert |
| `incident-db-corruption.md` | better-sqlite3 SQLITE_CORRUPT | 进 backup 找最近 .gz / VACUUM INTO / 切回去 |
| `incident-deepseek-down.md` | LLM circuit_open=true 持续 | 切 fallback / 人工降级文案 / 联系厂商 |
| `incident-static-404.md` | 用户报"页面白屏" | 检查 STATIC_FILE_ALLOW / nginx / pm2 logs / 静态文件存在性 |

每份固定结构：症状 / 第一时间动作 / 根因排查 / 修复 / 事后复盘。

---

### Phase E — Docker 决策 + DR 演练（~2h）

**E-1 R-16: Docker 决策**

现状：repo 根有 `Dockerfile` + `.dockerignore`，但**生产用 pm2 直起 node**，没用 docker。  
决策矩阵：

| 选项 | 收益 | 成本 |
|------|------|------|
| A 删 Dockerfile | -1 个误导文件 | 失去未来 k8s 化的起点 |
| B 留着 + 加 CI 构建测试 | 可用作未来迁移基础 + dev 隔离环境 | CI 多 1 min |
| C 真切到 docker compose 生产 | 隔离更强 | pm2 cluster 都得改，1 天工作量 |

**采用 B**：保留 Dockerfile，在 CI 加 `docker build` 步骤验证它真的能构建。  
未来想切容器化时不用从零写。

**E-2 R-21: DR 演练**

恢复最近一次 `/data/backups/*.gz` 到 `/tmp/dr-test/`，跑 `npm run db:smoke`，确认能读、行数对得上。  
写到 `docs/runbooks/incident-db-corruption.md` 的"演练记录"段。

---

## 4. 全局符号 / 文件影响清单

| 文件 | 改动类型 |
|------|----------|
| `package.json` | 更新 3 个 script 路径（calibration 搬走） |
| `tests/calibration/*.js` | 修 `webRoot = path.join(__dirname, "..", "..", "web")` |
| `.github/workflows/ci.yml` | 新建 |
| `CONTRIBUTING.md` | 新建 |
| `scripts/ops/health-check.sh` | 新建 |
| `scripts/ops/daily-report.sh` | 新建 |
| `scripts/ops/check-env-perms.sh` | 新建 |
| `docs/runbooks/incident-deploy-failed.md` | 新建 |
| `docs/runbooks/incident-db-corruption.md` | 新建 |
| `docs/runbooks/incident-deepseek-down.md` | 新建 |
| `docs/runbooks/incident-static-404.md` | 新建 |
| `docs/runbooks/env-management.md` | 新建 |
| `docs/superpowers/audits/2026-04-27-project-audit.md` | 同步状态 |

---

## 5. 验收口径（DoD）

按阶段：
- **Phase A**：根目录看不到 `*-calibration.js` / `*-eval.js` / `*-smoke-test.js`；`npm run test:reply` 仍能跑通；`CONTRIBUTING.md` 进 repo 根
- **Phase B**：GH Actions 第一次绿；故意删 `cards.json` push 一次 → CI 红 → 撤回 → 绿
- **Phase C**：服务器 `crontab -l` 看得到 2 条；`/var/log/book-of-elon/daily-report.log` 第二天有内容
- **Phase D**：`docs/runbooks/` 5 份齐全
- **Phase E**：CI 里 docker build 步骤绿；DR 演练记录写进 runbook

---

## 6. 回滚策略

- 每个 Phase 一个或多个 commit，独立可 revert
- CI 文件出错只影响 GH Actions，不会阻塞 push（除非配 branch protection，本批次不配）
- cron 上线前手动 `bash health-check.sh` 验证一遍
- DR 演练只读 backup，不动生产 DB

---

## 7. 时间预估

| Phase | 估时 |
|-------|------|
| A | 60 min |
| B | 90 min |
| C | 120 min |
| D | 120 min |
| E | 120 min |
| 服务器部署+验证 | 60 min |
| **合计** | **~9.5 h** |

按 superpowers 一次跑完，不分多个 session。

---

> Status: drafted 2026-04-27 → executed same day. All in-scope items ✅.  
> 服务器端动作（cron 安装 + DR 演练）在 commit & push 之后单独执行。
