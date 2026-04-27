# Runbook · `.env` 文件管理（env management）

> 这不是事故 runbook，是**操作 SOP**——任何人改 `.env` 之前必须看一遍。

| | |
|---|---|
| **首次记录** | 2026-04-27 (Wave 3 R-03) |
| **关联** | `scripts/ops/check-env-perms.sh` 每天 03:00 cron 自动校正 |

---

## 1. 永久红线（破坏即事故）

| 红线 | 后果 | 兜底 |
|---|---|---|
| `.env` **永远** 600 权限 | 其他用户能读到 DEEPSEEK_API_KEY → 余额被烧 / key 泄漏 | check-env-perms.sh 每天扫，发现自动 chmod 600 |
| `.env` **永远不进 git** | key 进 git history 永远清不掉，必须 rotate | `.gitignore` 列了 `.env` |
| 占位符 / 模板 / 真值**严禁**复制粘贴 | 把 `replace_with_xxx` 推到生产 → preflight 拒绝启动 | `preflight-check.js` 的 `looksLikePlaceholderValue` |
| 改完不跑 preflight 直接 reload | pm2 反复 restart，service 不可用 | 见 §3 标准流程 |

---

## 2. 文件位置

```
/root/skill_The_book_of_Elon/.env       # 生产，root 拥有，600
~/skill_The_book_of_Elon/.env           # 本地开发，user 拥有，600
.env.example                             # 跟入 git，给"30 天后的你"看
.env.production.example                  # 跟入 git，仅生产相关项
```

**为什么不放 `/etc/book-of-elon/`？**

考虑过迁过去（pm2 用 `env_file: /etc/book-of-elon/env`），但：
- pm2 ecosystem.config.js 不直接读外部 env_file（要在脚本里 source）
- 多一层跳转，未来 debug 多一道认知成本
- 真正的安全收益来自 600 + 不进 git，已经达成

**结论**：保留在 repo 根，靠 `chmod 600` + `.gitignore` + cron 校正足够。
如果未来真要多服务共享 .env，再迁。

---

## 3. 标准修改流程

```bash
# 1. 备份当前
cp .env .env.bak.$(date +%Y%m%d-%H%M%S)
ls -la .env*

# 2. 编辑
nano .env
# 改完保存

# 3. 强制 600
chmod 600 .env
ls -la .env
# 期望：-rw------- root root

# 4. 离线 preflight 校验
node preflight-check.js --strict-production
# 期望：PRECHECK PASSED
# 任何 ERROR 都 → 别 reload，回去改

# 5. 看修改差异（不要打印 secret 段）
diff .env.bak.<timestamp> .env | grep -v -E '(API_KEY|SECRET|PASSWORD)'

# 6. reload
pm2 reload book-of-elon --update-env
sleep 3

# 7. 验证
curl -s http://127.0.0.1:3000/api/health | head -c 400

# 8. 没问题就清掉 30 天前的 .env.bak
find /root/skill_The_book_of_Elon -maxdepth 1 -name '.env.bak.*' -mtime +30 -delete
```

---

## 4. 权限自检

```bash
bash scripts/ops/check-env-perms.sh
# 静默 = 全绿
# 写日志到 /var/log/book-of-elon/incident.log = 修复了某项
tail -20 /var/log/book-of-elon/incident.log | grep CHECK_ENV_PERMS
```

cron（已加）：

```cron
0 3 * * * /root/skill_The_book_of_Elon/scripts/ops/check-env-perms.sh
```

---

## 5. 密钥轮换（rotate）

DeepSeek key、SMS key、SESSION_TOKEN_SECRET 在以下情况**必须** rotate：

- 怀疑泄漏（log 里出现过 / 截图发到群里 / 不慎进 git history）
- 离职 / 团队成员变更
- 每年定期（建议 12 月）

**DeepSeek 流程**（其他类似）：

```bash
# 1. 生成新 key（DeepSeek 控制台 → API Keys → Create）
#    https://platform.deepseek.com/api_keys

# 2. 更新 .env（按 §3）
nano .env
# DEEPSEEK_API_KEY=sk-<新>

# 3. reload + 验证
chmod 600 .env
pm2 reload book-of-elon --update-env
sleep 3
curl -s http://127.0.0.1:3000/api/health | grep -A 3 '"llm"'
# 期望：status=ok, circuit_open=false

# 4. 在 DeepSeek 控制台 revoke 旧 key（不是 disable，是 revoke）

# 5. 看 30 分钟没异常 → rotate 完成
pm2 logs book-of-elon --nostream --lines 200 | grep -iE 'unauthorized|forbidden|401|403'
# 期望：空
```

---

## 6. 把 secret 不慎进 git history 的应急

**绝对不要 force-push 重写 history**——其他人 / CI / 镜像可能已经 fetch 走了。
唯一正确做法是**马上 rotate 那个 key**，然后：

```bash
# 1. 看 secret 在哪个 commit
git log -p --all | grep -B 2 -A 1 '<secret-pattern>' | head

# 2. rotate 该 key（按 §5）

# 3. 在新 commit 里把代码里的占位符替成新值（如果代码里也写过）

# 4. 写一行进事故 log
echo "[$(date -u +%FT%TZ)] SECRET LEAK: <type> rotated (old key in git history but revoked)" \
  >> /var/log/book-of-elon/incident.log
```

---

## 7. 当前 .env 字段清单（速查）

按 `.env.example` 维护，不在这里复制（避免双源漂移）。
直接：

```bash
diff <(grep -E '^[A-Z_]+=' .env.example | sort) \
     <(grep -E '^[A-Z_]+=' .env | sort) | head -30
```

应该只在**值**上差，键名差 = .env.example 未更新或生产漂移。

---

## 8. 历史事件

| 日期 | 事件 | 影响 | 防御演进 |
|---|---|---|---|
| 2026-04 | DeepSeek key 被攻击者用 | ¥100 损失 | 临时禁 + 后续 R-01 cost guardrails |
| 2026-04-27 | 加 R-03 + check-env-perms.sh | 0 | 自动 chmod 600 |
