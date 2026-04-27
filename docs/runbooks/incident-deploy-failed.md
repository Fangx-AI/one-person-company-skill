# Runbook · 部署失败 / 服务起不来（deploy failed）

| | |
|---|---|
| **首次记录** | 2026-04-27 |
| **触发场景** | `git pull && pm2 reload book-of-elon` 后服务红 / `/api/health` 不 200 / pm2 标 `errored` |
| **当前防护** | preflight-check.js + ecosystem.config.js + Wave 3 R-14 health-check.sh 自动 reload |

---

## 0. 一句话决策树

```
pm2 list 看到 errored → pm2 logs --err 找 stack
  ├ "FATAL" / "Error: Cannot find module" → 依赖坏 / git pull 缺文件 → §3
  ├ better-sqlite3 报错             → §4 跳到 incident-db-corruption
  ├ EADDRINUSE                      → §5 端口冲突
  ├ FATAL refused to start (SMS)    → §6 SMS_PROVIDER 漂移
  └ 其他                            → §7 全量回滚
```

---

## 1. 现象判定

满足任一项即进本 runbook：

- `pm2 list` 看到 `book-of-elon` 状态为 `errored` / `stopped` / 反复 restart
- `/api/health` 连续 2 分钟不返回 200（health-check.sh 已经触发过 1 次自动 reload 仍未恢复）
- 用户报"页面打不开 / 502"
- `pm2 reload` 命令本身报错退出码非 0

---

## 2. 30 秒诊断（必跑）

```bash
ssh root@8.210.245.109   # 然后 sudo -i
cd /root/skill_The_book_of_Elon

# A. pm2 状态
pm2 list

# B. 最近 200 行日志
pm2 logs book-of-elon --err --nostream --lines 200 | tail -60
pm2 logs book-of-elon --out --nostream --lines 200 | tail -60

# C. 当前是哪个 commit
git log --oneline -3

# D. 健康检查（如果服务还活着但慢）
curl -m 5 -s http://127.0.0.1:3000/api/health || echo "health timeout"
```

---

## 3. 故障：依赖坏 / 文件缺失

**症状**：`Error: Cannot find module 'xxx'` / `MODULE_NOT_FOUND` / 某个 require 路径找不到

**根因（按概率从高到低）**：
1. `git pull` 没拿全（网络断 / 冲突）→ 看 `git status` 是不是 dirty
2. `npm install` 没跑（package.json 改了但 node_modules 没同步）
3. 改名/搬位置后 require 路径漂移（比如 Wave 2 把 calibration 搬到 tests/calibration/）

**修复**：

```bash
git status                                    # 必须 clean
git fetch --all --prune
git reset --hard origin/main                  # 如果 dirty 且能确认无本地改动
npm ci                                        # ci 比 install 严格，按 lock 装
node preflight-check.js --allow-degraded     # 离线检查
pm2 reload book-of-elon --update-env
sleep 3
curl -s http://127.0.0.1:3000/api/health | head -c 300
```

---

## 4. 故障：DB 报错

跳转 `docs/runbooks/incident-db-corruption.md`。

---

## 5. 故障：端口冲突 EADDRINUSE

**症状**：日志里 `Error: listen EADDRINUSE: address already in use :::3000`

**根因**：
- 上次 reload 旧进程没退干净（罕见）
- 别的服务占了 3000（你忘了之前在做什么）

**修复**：

```bash
ss -tnlp | grep 3000             # 看谁在占
# 找到 PID
kill -TERM <pid>
sleep 2
ss -tnlp | grep 3000             # 应该空了
pm2 restart book-of-elon
```

如果不是 pm2 自己进程占的，要看 monitor-server.js（pm2 list 里有 `book-of-elon-monitor`，跑在 3001）—— **不要**误杀它。

---

## 6. 故障：SMS_PROVIDER 漂移（生产硬拒绝）

**症状**：启动 fail，日志里：

```
[boot] FATAL: production refused to start with SMS provider: mock
```

或：

```
[sms-sender] No SMS provider configured in production. ...
```

**根因**：`auth/sms-sender.js` 在 `NODE_ENV=production` 下硬要求 `SMS_PROVIDER=aliyun` + `ALIYUN_*` 全配，否则**故意启动失败**——避免 OTP 通过 HTTP 响应泄漏。

**修复**：

```bash
# 检查 .env 里这 5 个变量
grep -E '^(NODE_ENV|SMS_PROVIDER|ALIYUN_ACCESS_KEY_ID|ALIYUN_ACCESS_KEY_SECRET|ALIYUN_SMS_SIGN_NAME|ALIYUN_SMS_TEMPLATE_CODE)=' .env

# 如果有缺失（比如 key 被 rotate 后忘了更新），补回去
nano .env

# .env 必须 600
chmod 600 .env
ls -la .env

pm2 reload book-of-elon --update-env
sleep 3
pm2 logs book-of-elon --err --nostream --lines 50
```

---

## 7. 终极手段：回滚到上一个稳定版本

如果 §3-§6 都没搞定，且服务持续 down >5 分钟：

```bash
cd /root/skill_The_book_of_Elon
# 看最近能跑的 commit（通常是上一次 push）
git log --oneline -10

# 回滚（不要 reset --hard origin/main，那样会回到当前坏的版本）
git checkout <last-good-sha>
pm2 reload book-of-elon --update-env
sleep 5
curl -s http://127.0.0.1:3000/api/health | head -c 300
```

服务起来后**立刻**：
1. 在本地 reproduce 失败的那个 commit 的问题
2. 修好后写新 commit（不要直接 push 那个回滚操作到 main）
3. 修好的版本在本地跑过 `npm run cost:smoke` + `static:smoke` 才再 push

---

## 8. 事后复盘（每次都填）

每次进过这个 runbook，在文末"历史事件"加一行：

```markdown
| 日期 | 触发原因 | 解决路径 | 学到什么 / 新加的防护 |
|---|---|---|---|
| 2026-04-27 | 例：MODULE_NOT_FOUND（git pull 没干净） | §3 reset --hard + npm ci | 加 CI 检查（R-18 已落） |
```

---

## 9. 历史事件记录

| 日期 | 触发原因 | 解决路径 | 学到 / 新加防护 |
|---|---|---|---|
| 2026-04-26 | book-of-elon down (CrashLoop) | 重启 pm2，原因不明 | 加 health-check cron R-14 |

> 待补充。
