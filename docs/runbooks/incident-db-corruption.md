# Runbook · SQLite 数据损坏 / 恢复（db corruption / restore）

| | |
|---|---|
| **首次记录** | 2026-04-27 |
| **触发场景** | better-sqlite3 抛 `SQLITE_CORRUPT` / `database disk image is malformed` / 数据可见但 query 异常 |
| **当前防护** | `scripts/ops/backup-db.js` 每天压缩备份到 `data/backups/` |

---

## 0. 一句话决策树

```
看到 SQLITE_CORRUPT
  ├ 服务还在响应（只是单条 query 报错）→ §3 在线诊断（不停服）
  └ 服务挂了 / restart loop      → §4 切只读 + 从最近 backup 恢复
```

---

## 1. 现象判定

满足任一项进本 runbook：

- pm2 logs 出现 `SQLITE_CORRUPT` / `database disk image is malformed` / `database is locked` 持续 > 1 分钟
- `npm run smoke:db` 失败
- `/api/health` 的 `db.status != "ok"` 持续 2 分钟
- `data/app.db` 文件大小异常（突然变成 0 / KB 级）
- 用户报"我的对话历史不见了"

---

## 2. 立即止血（< 60 秒）

```bash
ssh root@8.210.245.109   # sudo -i
cd /root/skill_The_book_of_Elon

# 1. 不要！立刻！pm2 restart —— 重启 may make it worse
# 2. 先把当前 DB 文件冷拷一份，不管它有多坏
DATESTAMP=$(date +%Y%m%d-%H%M%S)
cp -a data/app.db "data/app.db.broken-${DATESTAMP}"
ls -la data/app.db*

# 3. 看看 sqlite3 自己怎么说
sqlite3 data/app.db "PRAGMA integrity_check;" 2>&1 | head -20
# 期望：ok
# 异常：会列出一堆错误页 / "Page X is never used" 之类
```

---

## 3. 在线诊断（服务还能响应时）

如果 `/api/health` 还 200 但 db 报错：

```bash
# 看 pm2 错误日志最近 200 行
pm2 logs book-of-elon --err --nostream --lines 200 | grep -i sqlite | tail -30

# 看具体哪张表
sqlite3 data/app.db ".tables"
sqlite3 data/app.db "SELECT count(*) FROM users;"
sqlite3 data/app.db "SELECT count(*) FROM chat_sessions;"
sqlite3 data/app.db "SELECT count(*) FROM messages;"
sqlite3 data/app.db "SELECT count(*) FROM facts;"

# 如果某张表查不出来 / 报 corrupt → 该表损坏
```

如果只是单表损坏，可能能修：

```bash
# 用 .recover 倒出能读的部分
sqlite3 data/app.db ".recover" > /tmp/recovered.sql
wc -l /tmp/recovered.sql

# 看是不是合理大小（几千-几万行 SQL 是正常）
head -100 /tmp/recovered.sql

# 如果合理，临时建个新 DB 看看能不能 import
sqlite3 /tmp/test-restore.db < /tmp/recovered.sql
sqlite3 /tmp/test-restore.db "SELECT count(*) FROM messages;"
```

如果 .recover 出来的数据合理，进 §5 切换流程。

---

## 4. 服务挂了：从备份恢复

```bash
# 1. 停 pm2，防止 better-sqlite3 重复打开半坏 DB
pm2 stop book-of-elon

# 2. 把当前坏文件移走（不删，留着事后取证）
DATESTAMP=$(date +%Y%m%d-%H%M%S)
mv data/app.db "data/app.db.broken-${DATESTAMP}"
mv data/app.db-shm "data/app.db-shm.broken-${DATESTAMP}" 2>/dev/null
mv data/app.db-wal "data/app.db-wal.broken-${DATESTAMP}" 2>/dev/null

# 3. 找最近一份备份
ls -lat data/backups/ | head -10
# 期望：scripts/ops/backup-db.js 输出，命名形如 app-YYYYMMDD-HHMMSS.db.gz

LATEST_BACKUP=$(ls -t data/backups/app-*.db.gz | head -1)
echo "Will restore from: $LATEST_BACKUP"

# 4. 解压到 /tmp 先验证一下能读
gunzip -c "$LATEST_BACKUP" > /tmp/restore-candidate.db
sqlite3 /tmp/restore-candidate.db "PRAGMA integrity_check;"
sqlite3 /tmp/restore-candidate.db "SELECT count(*) FROM users;"
sqlite3 /tmp/restore-candidate.db "SELECT count(*) FROM messages;"
# 期望：integrity_check = ok，行数合理

# 5. 拷过去，权限要对
cp /tmp/restore-candidate.db data/app.db
chown root:root data/app.db   # 或 boe:boe，跟现有 .env / pm2 配置一致
chmod 644 data/app.db

# 6. 起服务
pm2 start book-of-elon
sleep 5
curl -s http://127.0.0.1:3000/api/health | head -c 400
# 期望："status":"ok","db":{"status":"ok"
```

**警告**：从备份恢复 = 丢失备份时刻到事故时刻的全部数据。说明给最近活跃用户。

---

## 5. .recover 重建（更激进，但能多救一些数据）

只有在你 §3 看到 `.recover` 出来的数据比最近 backup **明显更新**时用：

```bash
pm2 stop book-of-elon

# 用 .recover 出来的 SQL 重建
sqlite3 /tmp/rebuilt.db < /tmp/recovered.sql
sqlite3 /tmp/rebuilt.db "PRAGMA integrity_check;"
sqlite3 /tmp/rebuilt.db "SELECT count(*) FROM messages;"

# 跟 backup 对比
gunzip -c "$LATEST_BACKUP" > /tmp/backup.db
sqlite3 /tmp/backup.db "SELECT count(*) FROM messages;"

# 取行数多 + integrity_check = ok 的那一份
cp /tmp/rebuilt.db data/app.db    # 或 /tmp/backup.db
chmod 644 data/app.db
pm2 start book-of-elon
```

---

## 6. 验证恢复成功

```bash
# 服务 health
curl -s http://127.0.0.1:3000/api/health | head -c 400

# DB smoke（用临时库不动 prod）
SQLITE_DB_PATH=/tmp/post-restore-smoke.db npm run smoke:db

# 跑一次真业务请求看能不能登录 / 拉历史
# 用一个测试手机号在前端走一遍
```

---

## 7. 防御演进 / 长期项

每次出过事，update 这一段：

- [ ] **每天 03:00 cron 跑 backup-db.js**（已落 R-14 cron）
- [ ] **每周 1 次 DR 演练**：从 backup 恢复到 /tmp，跑 smoke 验证（R-21）
- [ ] **`/api/health` 把 backup 新鲜度暴露出来**（最近一次成功备份的时间）
- [ ] **WAL checkpoint 周期改成更频繁**（防止单次 fsync 失败把 30 分钟的 wal 全干掉）
- [ ] **off-site 备份**：每周把 `data/backups/` 同步到 OSS（防止 ECS 整个挂掉）

---

## 8. DR 演练记录

每次演练都填一行（验证 backup 真的能用）：

| 日期 | 演练内容 | backup 文件 | 恢复用时 | 数据完整性 | 备注 |
|---|---|---|---|---|---|
| 2026-04-27 | Wave 3 R-21 首次演练 | `app-2026-04-27T08-00-01.db.gz` (42 KB) | < 1 s | `integrity_check=ok` + schema sha256 与 prod 一致 | `npm run db:dr-drill` 一次性跑通；`smoke:db` 也在恢复出的临时库上 PASS。复演命令落到 `scripts/ops/dr-drill.js`。 |

---

## 9. 历史事件记录

| 日期 | 现象 | 根因 | 恢复路径 | 数据丢失 | 防御演进 |
|---|---|---|---|---|---|
| _尚无_ | | | | | |

> 第一条事故记录前，这表保持空。
