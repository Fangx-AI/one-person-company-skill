# DEPLOY.md — 把"账号 + 记忆系统"发布到 bookofelon.cn

> 这一份是**本次发布**的精准操作手册。基础环境装机/Nginx/PM2 装好之后的常规
> 上线流程在 `DEPLOY_RUNBOOK.md`，本文不再复述。
>
> 本次新增内容：
> - 手机号 + 短信验证码登录（阿里云 SMS）
> - 北极星目标 + AI 自动抽取的关键事实（facts 表）
> - 跨会话记忆注入到 prompt
> - `/api/health` 深健康检查端点
> - 个人页 modal（"AI 记得的事"）

---

## 1. 上线前 5 分钟检查（本地）

```bash
# 1.1 单元 + 集成测试全过
node scripts/test-fact-extractor.js     # 14/14
$env:USER_SESSION_SECRET="testing_secret_with_at_least_32_chars_xxxxxxxxx"
node scripts/integration-memory.js      # 10/10（自动用 data/test.db 隔离）

# 1.2 dry-run 迁移看看本地 schema 完整
node scripts/migrate.js

# 1.3 本地 server 健康检查
curl http://127.0.0.1:3000/api/health   # status=ok, db.status=ok, llm.status=ok
```

**任意一项失败，停下，不要 push。**

---

## 2. 服务器侧准备（一次性）

### 2.1 必填的系统环境变量

把下面四组以**真实系统环境变量**形式 export，**不要**只放在 `.env` 里
（生产 `NODE_ENV=production` 时，`auth/session.js` 会硬拒绝缺失 secret）。

```bash
# 用 systemd 的就写到 /etc/systemd/system/book-of-elon.service 的 Environment=
# 用 PM2 的就写到 ecosystem.config.js 的 env_production
# 用 docker 的就 -e 或 --env-file

NODE_ENV=production
USER_SESSION_SECRET=<openssl rand -hex 32>          # 必填，至少 32 字符
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxx                 # 必填
SMS_PROVIDER=aliyun
ALIYUN_ACCESS_KEY_ID=...
ALIYUN_ACCESS_KEY_SECRET=...
ALIYUN_SMS_SIGN_NAME=...
ALIYUN_SMS_TEMPLATE_CODE=...
SQLITE_DB_PATH=/var/lib/book-of-elon/app.db         # 推荐放 /var/lib，不放仓库内
```

**生成 secret 的标准姿势**：
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2.2 阿里云短信前置条件

- 已开通"国内短信服务"
- 创建签名 `ALIYUN_SMS_SIGN_NAME`（审核 1-2 工作日）
- 创建模板 `ALIYUN_SMS_TEMPLATE_CODE`（含 `${code}` 变量）
- AccessKey 子账号只授权 `AliyunDysmsFullAccess`，**不要**用主账号 AK

---

## 3. 上线（每次 release 的标准流程）

```bash
# 3.1 在服务器上拉代码
cd /opt/book-of-elon          # 或你部署目录
git fetch --all
git status                    # 确认 working tree clean
git checkout main
git pull --ff-only

# 3.2 装依赖（better-sqlite3 是 native 必须 npm install）
npm ci --omit=dev

# 3.3 跑迁移 dry-run，看清要改什么
SQLITE_DB_PATH=/var/lib/book-of-elon/app.db node scripts/migrate.js

# 3.4 真跑迁移（自动备份 .backup-<timestamp>）
SQLITE_DB_PATH=/var/lib/book-of-elon/app.db node scripts/migrate.js --apply

# 3.5 重启进程
pm2 reload book-of-elon       # 或 systemctl restart book-of-elon
# 或 docker compose up -d --build
```

---

## 4. 上线后 60 秒烟雾测试

按顺序跑，**任何一步失败立刻回滚**（见第 6 节）。

```bash
# 4.1 深健康
curl https://bookofelon.cn/api/health | jq .
# 期望：status=ok, db.status=ok, db.counts.facts >=0, llm.status=ok, version=1.0.0

# 4.2 主页可加载
curl -I https://bookofelon.cn/ | head -1
# 期望：HTTP/2 200

# 4.3 未登录拿 dashboard 必须 401
curl -i https://bookofelon.cn/api/me/dashboard | head -1
# 期望：HTTP/2 401

# 4.4 真发一条短信测试（用你自己的手机号，会收到真验证码）
curl -X POST https://bookofelon.cn/api/auth/send-code \
  -H "Content-Type: application/json" \
  -d '{"phone":"13800000000"}'   # 换成你自己的号
# 期望：{"ok":true, "ttlSeconds":600}
# 同时手机应在 30 秒内收到验证码
```

---

## 5. 回归测试用户（自己当用户跑一遍）

打开 `https://bookofelon.cn`，强制刷新 (`Ctrl+Shift+R`)。

1. ✅ 主页正常显示，输入框可点
2. ✅ 点右上角登录 → 收到真短信 → 输入验证码 → 登录成功
3. ✅ 能设置北极星目标
4. ✅ 跟 AI 聊 3 轮
5. ✅ 关闭对话 → 新开对话 → 问 "你记得我说过什么吗？" → AI 引用了之前的内容
6. ✅ 点用户菜单 → 看到 "AI 记得的事" 列表，里面有真 facts

任何一步失败就回滚。

---

## 6. 回滚

```bash
# 6.1 代码回滚
cd /opt/book-of-elon
git log --oneline -10               # 找上一个 stable commit
git checkout <previous_sha>
npm ci --omit=dev
pm2 reload book-of-elon

# 6.2 DB 回滚（仅当迁移破坏数据）
ls -lt /var/lib/book-of-elon/app.db.backup-*    # 找 migrate 时自动备份
cp /var/lib/book-of-elon/app.db.backup-2026-04-18T13-00-00 \
   /var/lib/book-of-elon/app.db
pm2 reload book-of-elon
```

---

## 6.5 数据持久与备份（**上线前必须配**）

> 用户的事实、北极星、对话历史全在 `app.db` 里。如果服务器磁盘挂了
> 又没备份，所有用户的"AI 记得的事"会全部归零 — 这是产品口碑的事故。

### 6.5.1 SQLite 已开的安全设置

`db/schema.sql` 已经设了：
- `journal_mode=WAL` — 写入崩溃也不会损坏 DB
- `synchronous=NORMAL` — WAL 模式下安全且更快
- `foreign_keys=ON` — 删用户级联清理，不留孤儿数据

### 6.5.2 自动热备份

`scripts/backup-db.js` 用 SQLite `.backup()` API（**不会卡 server**），
gzip 压缩到 `data/backups/`，自动滚动保留最近 32 份。

```bash
# 手动跑一次试试
npm run db:backup

# 输出：OK  app-2026-04-18T13-22-02.db.gz  108KB -> 12KB (-88%)  47ms
```

### 6.5.3 cron 接入（生产 **必须** 配）

```bash
# 编辑服务器上 crontab：crontab -e
# 每小时整点备份一次
0 * * * * cd /opt/book-of-elon && /usr/bin/node scripts/backup-db.js >> /var/log/boe-backup.log 2>&1
```

### 6.5.4 把备份带出本机（**重要**）

只在本机存备份不够，磁盘整个挂了照样丢。**至少配一种**：

```bash
# 方案 A：每日 rsync 到另一台 VPS / NAS
30 2 * * * rsync -az /opt/book-of-elon/data/backups/ user@backup-host:/srv/boe-backups/

# 方案 B：每日推到对象存储（S3 / 阿里云 OSS / R2）
0 3 * * * aws s3 sync /opt/book-of-elon/data/backups/ s3://my-boe-backups/ --delete

# 方案 C：每日 sftp 到 NAS
```

### 6.5.5 灾难恢复演练（**至少做一次**）

每个月在测试环境演练一次，确保备份真的能恢复：

```bash
# 1. 取最近一份备份
cd /tmp
cp /opt/book-of-elon/data/backups/app-LATEST.db.gz .
gunzip app-LATEST.db.gz

# 2. 用临时 DB 启动服务器
SQLITE_DB_PATH=/tmp/app-LATEST.db PORT=3099 node server.js

# 3. 访问 http://server:3099/api/health 看 db.counts 是否齐全
curl http://localhost:3099/api/health | jq .db.counts

# 4. 自己用一个测试号登录，看历史 facts 在不在
```

**没演练过的备份 = 没备份。**

---

## 7. 监控接入建议

`/api/health` 返回值 body.status 三态：
- `"ok"` — 正常
- `"degraded"` — DB 正常但 LLM 熔断器打开（DeepSeek 暂时挂了，本地降级回复在工作）
- `"down"` — DB 挂了，应当立即告警

UptimeRobot / 阿里云监控 / Better Stack 等都可以读这个 JSON，告警规则：
- `status != "ok"` 持续 2 分钟 → P2 告警
- `status == "down"` → P0 告警，叫醒人
- `db.latency_ms > 100` 持续 5 分钟 → 性能 ticket

---

## 8. 已知的"软失败"（不影响发布，但要排程修）

- [ ] fact 抽取目前 hardcoded top 8 注入 prompt，等用户聊到 100 轮以上需要加权选择
- [ ] `book-source.js` 缺失，AI 回复仍然只有 24 张卡片摘要喂 RAG，没有完整书原文
- [ ] 没有"AI 记下你刚说的 X"的实时浮窗，用户得点用户菜单才知道 AI 记住了什么
- [ ] **没有"我的历史对话"列表页**：用户回来登录后看不到上次聊过什么，只能通过用户菜单看
      AI 抽取的 facts。数据 100% 在 `messages` 表里没丢，缺的只是 UI。建议下个版本加
      `/api/me/sessions` + 一个左侧抽屉式的"我的对话"列表。
