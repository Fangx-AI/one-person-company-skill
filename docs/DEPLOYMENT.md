# Deployment

> **本文档是部署的单一信源（Single Source of Truth）。**
> 之前的 `DEPLOY.md` / `DEPLOY_RUNBOOK.md` / `DEPLOY_CHECKLIST.md` 已归档到
> `docs/archive/`，仅供历史溯源。日常部署只看这一份。

按生命周期组织：首次装机 → 配置 → 例行部署 → 烟测 → 回滚 → 备份 → 监控。

| 章节 | 何时看 |
|---|---|
| §1 First-time setup | 第一次装新服务器，或换机 |
| §2 Environment config | 加环境变量 / 改 secret |
| §3 Routine deploy | 每次 release（**最常用**） |
| §4 Smoke tests | 部署后立刻验证 |
| §5 Rollback | 部署出问题 |
| §6 Backup & DR | 数据保护 + 灾难恢复 |
| §7 Monitoring & alerting | 告警接入 |
| §8 Multi-instance | 未来横向扩展时 |
| §A Security pre-flight | 上线前安全确认 |
| §B Soft failures | 已知次要问题，不阻塞发布 |

---

## 1. First-time Setup

只在**首次装新服务器**或**换机**时跑。

### 1.1 系统依赖

```bash
# Linux 服务器，Node.js >=20，PM2，Nginx
node -v        # ≥ v20.x（建议 22.x，跟生产一致）
npm -v
pm2 -v || npm install -g pm2
nginx -v
```

### 1.2 拉代码

```bash
git clone git@github.com:ab18108289/book-of-elon.git /root/skill_The_book_of_Elon
cd /root/skill_The_book_of_Elon
npm ci --omit=dev
```

> `npm ci` 而不是 `npm install` —— `better-sqlite3` 是 native 模块，必须按
> `package-lock.json` 锁定的版本编译，避免下次升 Node 再踩 ABI mismatch。
> 见 `docs/runbooks/incident-pm2-errored.md`（待写）。

### 1.3 数据库初始化

```bash
npm run db:init
```

之后每次启动都会自动跑 `db/auto-migrate.js`（缺表/缺列幂等补齐 + fail-fast 校验），不用手工。

### 1.4 启动 PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup    # ← 输出一条 sudo 命令，照着执行才算开机自启
```

### 1.5 Nginx + HTTPS

仓库内提供示例：`nginx.book-of-elon.conf.example`。

```bash
# 1. 替换 server_name 为你的真实域名
cp nginx.book-of-elon.conf.example /etc/nginx/sites-available/bookofelon
ln -s /etc/nginx/sites-available/bookofelon /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# 2. 申请证书
certbot --nginx -d bookofelon.cn

# 3. 验证
curl -I http://bookofelon.cn   # 应 301 / 302 跳 https
curl -I https://bookofelon.cn  # 200
```

---

## 2. Environment Config

所有 env 走 `.env`（仓库根目录）。生产强烈建议把 secret 用 systemd `Environment=`
或 PM2 `env_production` 注入，**不要把真 .env 放在 web cwd**（CSO #7 待修，见 R-03）。

### 2.1 必填变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | ✓ | 否则 chat 走本地降级 |
| `USER_SESSION_SECRET` | **必须** | ≥32 字符 hex；签账号 cookie；改了等于踢所有用户 |
| `SESSION_TOKEN_SECRET` | ✓ | 签匿名 chat token |
| `SMS_PROVIDER=aliyun` | 生产必须 | 缺则走 mock，**验证码会以明文返回**（CSO #3 已修复 prod fail-fast） |
| `ALIYUN_ACCESS_KEY_ID` / `_SECRET` | 生产必须 | 用专用 RAM 子账号，最小权限只给 SMS |
| `ALIYUN_SMS_SIGN_NAME` | 生产必须 | 阿里云审核通过的签名 |
| `ALIYUN_SMS_TEMPLATE_CODE` | 生产必须 | 已审核通过的模板编号 |
| `MONITOR_USERNAME` / `MONITOR_PASSWORD` | 生产必须 | 监控后台 basic auth |

生成 secret 的标准姿势：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2.2 可调变量（保留默认即可）

成本守门（R-01，2026-04 引入）：

```env
DEEPSEEK_MAX_TOKENS=400          # 单次回复上限（旧值 700，¥100 事件后调低）
DAILY_TOTAL_TOKEN_BUDGET=2000000 # 全站每日 token 总额 ≈ ¥10/天
DAILY_TOKEN_PER_IP=50000         # 单 IP 每日 token 配额
DAILY_ANON_CHAT_PER_SESSION=20   # 匿名 session 每日 chat 次数
```

完整列表见 `.env.example`。

### 2.3 自检（每次改完都跑）

```bash
npm run preflight              # 完整聊天模式
npm run preflight:degraded     # 允许本地降级
npm run preflight:prod         # 严格生产模式（缺关键 env 直接拒启动）
```

---

## 3. Routine Deploy（**最常用**）

### 3.1 一键部署（推荐）

服务器上：

```bash
cd /root/skill_The_book_of_Elon
bash scripts/ops/deploy.sh
```

`scripts/ops/deploy.sh` 是 canonical 路径。10 步流水线：

1. 预检环境（node / pm2 / 磁盘）
2. 部署前 DB 备份（即便不动 DB 也总是先备份）
3. `git fetch + pull --ff-only`
4. `npm ci --omit=dev`
5. 迁移 dry-run（看一眼 ALTER TABLE 列表）
6. 迁移 apply（自带备份）
7. `pm2 reload book-of-elon --update-env`（zero-downtime）
8. 等服务起来（最多 5s 轮询 `/health`）
9. 烟雾测试（`/api/health` + 主页 + 鉴权拒绝）
10. 报告新 sha + 关键 counts

任意一步失败 → 脚本立刻 exit + 留下 `*.predeploy-*` 备份给回滚用。

### 3.2 手动部署（救火用）

```bash
cd /root/skill_The_book_of_Elon
git fetch --all --prune && git pull --ff-only
npm ci --omit=dev
npm run db:migrate                        # dry-run（→ scripts/ops/migrate.js）
npm run db:migrate:apply                  # 真跑（自带 .backup-<ts>）
pm2 reload book-of-elon --update-env
sleep 3
curl -s http://127.0.0.1:3000/api/health | python3 -m json.tool | head -40
```

---

## 4. Smoke Tests

### 4.1 部署后必跑

```bash
curl -s http://127.0.0.1:3000/api/health | python3 -m json.tool
```

期望返回里的关键字段：

```json
{
  "status": "ok",
  "db": { "status": "ok", "latency_ms": 0, "counts": { "users": ..., "messages": ... } },
  "llm": { "status": "ok", "enabled": true, "circuit_open": false },
  "cost": { "global": { "tokens_used": ..., "tokens_budget": 2000000 } },
  "process": { "node": "v22.x.x" }
}
```

任一为 `down` / `disabled` / `circuit_open` → 见 §5。

### 4.2 浏览器 6 步回归

打开 `https://bookofelon.cn`，强制刷新 (`Ctrl+Shift+R`)：

- [ ] 主页正常显示，输入框可点
- [ ] 卡片能进详情，详情摘要可见
- [ ] 直接提问能返回 AI 回复（不是 fallback）
- [ ] 点登录 → 收到真短信 → 验证码 → 进入"我的路径"
- [ ] 设北极星目标 → 跟 AI 聊 3 轮 → 关闭 → 新开 → 问"你记得我说过什么吗"→ AI 引用之前内容
- [ ] 用户菜单"AI 记得的事" 列表里有真 facts

### 4.3 命令行 smoke

```bash
npm run smoke:chat          # /api/chat 走通
npm run cost:smoke          # cost 守门 30 个断言
npm run db:smoke            # 数据库 CRUD
npm run static:smoke        # 静态文件白名单生效
npm run prompt:smoke        # prompt 注入防护

# auth:smoke 只能在 SMS_PROVIDER=mock 下跑（要从响应读 devCode）
# 不能在生产跑
npm run auth:smoke          # dev/staging only
```

完整 30 断言（建议在 staging 跑）：

```bash
npm run test:e2e
```

---

## 5. Rollback

### 5.1 代码回滚

```bash
cd /root/skill_The_book_of_Elon
git log --oneline -10               # 找上一个 stable commit
git checkout <sha>
npm ci --omit=dev
pm2 reload book-of-elon --update-env
```

### 5.2 DB 回滚（仅当迁移破坏数据）

```bash
ls -lt data/app.db.backup-*         # migrate 时自动备份
ls -lt data/app.db.predeploy-*      # deploy.sh 部署前备份
cp data/app.db.predeploy-2026-04-27T06-30-00 data/app.db
pm2 reload book-of-elon
```

### 5.3 紧急止血：禁 LLM key

如果 LLM 在烧钱或被滥用：

```bash
sed -i 's/^DEEPSEEK_API_KEY=.*/DEEPSEEK_API_KEY=disabled_due_to_abuse/' .env
pm2 reload book-of-elon --update-env
# 用户体验：自动走本地 fallback，不会 500
```

恢复见 `docs/runbooks/incident-cost-spike.md` §5。

---

## 6. Backup & Disaster Recovery

### 6.1 SQLite 已有的安全设置

`db/schema.sql` 已设：
- `journal_mode=WAL` — 写入崩溃不损坏 DB
- `synchronous=NORMAL` — WAL 模式下安全且更快
- `foreign_keys=ON` — 删用户级联清理，不留孤儿数据

### 6.2 自动热备份

`scripts/ops/backup-db.js` 用 SQLite `.backup()` API（不卡 server）+ gzip + 轮转。

```bash
# 手动跑一次试试
npm run db:backup
# 输出：OK  app-2026-04-18T13-22-02.db.gz  108KB -> 12KB (-88%)  47ms
```

### 6.3 cron 接入（生产**必须**配）

```bash
( crontab -l 2>/dev/null
  echo "0 */4 * * * cd /root/skill_The_book_of_Elon && /usr/bin/node scripts/ops/backup-db.js >> /var/log/boe-backup.log 2>&1"
) | crontab -
crontab -l   # 确认
```

### 6.4 异地备份（**必须**配至少一种）

只在本机存备份不够，磁盘整个挂了照样丢：

```bash
# 方案 A：每日 rsync 到另一台 VPS / NAS
30 2 * * * rsync -az /root/skill_The_book_of_Elon/data/backups/ user@backup-host:/srv/boe-backups/

# 方案 B：每日推到对象存储
0 3 * * * aws s3 sync /root/skill_The_book_of_Elon/data/backups/ s3://my-boe-backups/ --delete
```

### 6.5 DR 演练（**至少做一次**）

每月 1 次在测试环境演练：

```bash
# 1. 取最近一份备份
cp /root/skill_The_book_of_Elon/data/backups/app-LATEST.db.gz /tmp/
gunzip /tmp/app-LATEST.db.gz

# 2. 用临时 DB 启动服务器
SQLITE_DB_PATH=/tmp/app-LATEST.db PORT=3099 node server.js &

# 3. 看 db.counts 齐全
curl -s http://127.0.0.1:3099/api/health | python3 -m json.tool | grep -A 6 counts

# 4. 用测试号登录，看历史 facts 在不在
```

> **没演练过的备份 = 没备份。**

---

## 7. Monitoring & Alerting

### 7.1 `/api/health` 三态

| status | 含义 | 告警 |
|---|---|---|
| `ok` | 全绿 | 无 |
| `degraded` | DB 正常但 LLM 熔断（fallback 在工作） | P2，2 分钟持续报 |
| `down` | DB 挂了 | **P0 立即叫醒人** |

### 7.2 告警规则建议

```
status != "ok"           持续 2 min  → P2
status == "down"         立即       → P0
db.latency_ms > 100      持续 5 min  → 性能 ticket
cost.global.utilization_pct > 80%   → P1（异常烧钱信号）
upstream_request_failed  5 min 激增  → P1
```

### 7.3 接入方式（按成本递增）

- **零成本**：cron + mail（每 5 分钟拉 `/api/health`，非 ok 发邮件）
- **简单**：UptimeRobot 免费档（接 `/api/health`，5 分钟一次）
- **完整**：阿里云云监控 / Better Stack

### 7.4 关键日志事件

`server.js` 输出 JSON 日志，关键事件：

| event | 含义 | 优先级 |
|---|---|---|
| `server_failed_to_listen` | 启动失败 | P0 |
| `upstream_request_failed` | LLM 调用失败 | 看频率 |
| `chat_request_rejected` | 同源/token 校验失败（多了说明被攻击） | 看频率 |
| `cost_guardrail_triggered` | R-01 三道闸触发 | 累计跟踪 |
| `request_completed` 含 `slowRequest=true` | 慢请求 | P2 |

详细字段定义见 §B（旧 `OBSERVABILITY.md` 内容已合入此处）。

### 7.5 独立监控后台

`monitor-server.js` 跑在 `127.0.0.1:3201`，读 `/health` + `pm2 jlist` + PM2 日志。

```bash
# 通过 SSH 端口转发本地访问
ssh -L 3201:127.0.0.1:3201 root@bookofelon.cn
# 浏览器：http://127.0.0.1:3201（先用 MONITOR_USERNAME/PASSWORD 登录）
```

---

## 8. Multi-instance（未来扩展）

当前架构是**单实例**。如果未来要多实例放量：

- 限流（`rateLimitStore`）：内存 → Redis
- 缓存（`responseCache`）：内存 → Redis  
- Cost guardrails（R-01）：内存 → SQLite（已加 IP/anon 表）或 Redis
- 短信节流（`sms-throttle`）：内存 → Redis
- Session：当前已经是无状态 HMAC cookie，**不用动**
- DB：SQLite → Postgres / MySQL（当前规模没必要）

实施前先压测看真的需要再做，过早优化是反模式。

---

## §A Security Pre-flight Checklist

每次大改前过一遍（自动化版本：考虑加入 `scripts/ops/deploy.sh` 第 0 步）：

- [ ] `.env` 不在 git 历史里：`git log --all --full-history -- .env`
- [ ] Aliyun AccessKey 是专用 RAM 子账号，权限只有 SMS
- [ ] 历史泄漏过的 AccessKey 已在阿里云控制台**禁用并删除**（不只禁用）
- [ ] `MONITOR_USERNAME` / `MONITOR_PASSWORD` 不是默认占位值
- [ ] `.env` 文件权限 `600`：`chmod 600 .env`
- [ ] **无登录拿 dashboard 必须 401**：`curl -i https://bookofelon.cn/api/me/dashboard | head -1`
- [ ] **静态白名单生效**：`curl -i https://bookofelon.cn/data/app.db | head -1` 期望 404
- [ ] **System prompt 注入失败**：`npm run prompt:smoke`

完整威胁模型见 `docs/security/audits/2026-04-14-cso-audit.md`。

---

## §B Observability Reference（合自原 OBSERVABILITY.md）

### 日志形态

JSON to stdout，PM2 / Nginx access log 双采集。

### 启动类事件

- `startup_validation_failed` / `startup_validation_warning`
- `server_listening` / `server_failed_to_listen` / `server_shutdown_requested`

### 请求类事件

`request_completed`，关键字段：`statusCode` / `durationMs` / `slowRequest` / `route` / `provider` / `cacheHit` / `degraded` / `error`

### 异常类

- `upstream_request_failed`
- `server_request_unhandled_error`

### 安全 / 滥用

- `chat_request_rejected`（reason: invalid_token / cross_origin / 等）
- `cost_guardrail_triggered`（reason: daily_budget_exhausted / ip_daily_quota_exhausted / anon_daily_chat_exhausted）

### 观察指标建议

总请求量 · `/api/chat` 量 · 拒绝量 · 429 比例 · 5xx 比例 · `degraded` 比例 · `cacheHit` 比例 · 慢请求比例 · 上游失败码分布 · `cost.utilization_pct` 趋势

---

## §C Soft Failures（不阻塞发布）

- [ ] fact 抽取目前 hardcoded top 8 注入 prompt，>100 轮后需要加权选择
- [ ] `book-source.js` 是 OCR 全文，未来可能改 RAG 切片（R-06 已转 JSON）
- [ ] 没"AI 记下你刚说的 X" 的实时浮窗，用户得点用户菜单
- [ ] 没"我的历史对话"列表页（数据在 `messages` 里没丢，缺 UI）

---

## 文档历史

| 日期 | 变更 | 作者 |
|---|---|---|
| 2026-04-27 | 合 3 份 DEPLOY 为本文（R-09 / Wave 2 Phase A） | Claude |
| 2026-04-19 | （历史 3 份分别为：DEPLOY.md = release-specific；DEPLOY_RUNBOOK.md = 装机；DEPLOY_CHECKLIST.md = 勾选式） | — |
