# Runbook · DeepSeek 上游故障 / 降级（deepseek down）

| | |
|---|---|
| **首次记录** | 2026-04-27 |
| **触发场景** | DeepSeek 接口 5xx / 超时 / 限流 / 余额 0 持续 > 1 分钟，circuit breaker 打开 |
| **当前防护** | 服务端 circuit breaker（`CIRCUIT_BREAKER_FAIL_THRESHOLD` + `CIRCUIT_BREAKER_COOLDOWN_MS`） + local fallback |

---

## 0. 一句话决策树

```
/api/health → llm.status
  ├ "ok"                  → 没事
  ├ "idle"                → 启动后还没真请求过 — 等一两分钟再看
  ├ "stale_ok"            → 5 min 内没人调用，最后一次是成功 — 通常没事
  ├ "stale_degraded"      → 5 min 内没人调用，最后一次失败 — 看 last_failure_*
  ├ "degraded"            → 5 min 内有调用且全部失败 — 立刻看 last_failure_status
  │   ├ status=401  → §6 key 失效（我们自己原因，联系厂商或 rotate）
  │   ├ status=402  → §4 余额不足（充值）
  │   ├ status=403  → §6 key 被封
  │   ├ status=5xx  → §5 上游故障（等 / 公告 / 备选评估）
  │   └ status=null → 网络/超时（看 last_failure_code）
  ├ "circuit_open"        → 连续 5 次失败已熔断；30 秒冷却后会自动 half-open
  └ "disabled"            → DEEPSEEK_API_KEY 没配（不是事故，是状态）
```

> **注意**：4 月 25 日那次"key 占位符 + 用户全走 fallback"事件后，R-26 给了
> health 一个**真实的滚动窗口信号**。如果你看到 `llm.status === "ok"`，那是
> 真的有近 5 分钟内成功调用。不会再像以前那样静默撒谎。

---

## 1. 现象判定

任一项进本 runbook：

- `/api/health` 返回 `llm.status` ∈ {`degraded`, `circuit_open`, `stale_degraded`}（R-26 后的真实信号）
- `/api/health` 返回 `llm.circuit_open: true` 持续 > 1 分钟（旧字段，仍保留）
- `pm2 logs` 里 `upstream_request_failed` 或 `upstream_timeout` 突然集中（>5/分钟）
- 用户报"AI 没回答 / 一直转圈"
- DeepSeek 控制台显示余额 ≤ 5 元 / API 调用全 4xx 5xx
- daily-report.sh 警告 `DEEPSEEK_BALANCE_LOW`

---

## 2. 30 秒诊断

```bash
ssh root@8.210.245.109 && sudo -i
cd /root/skill_The_book_of_Elon

# A. 看 health
curl -s http://127.0.0.1:3000/api/health | head -c 400

# B. 看最近上游错误
pm2 logs book-of-elon --nostream --lines 500 \
  | grep -E 'upstream_(request_failed|timeout|circuit)' \
  | tail -30

# C. 看 DeepSeek 自己的状态
DEEPSEEK_KEY=$(grep '^DEEPSEEK_API_KEY=' .env | sed 's/^DEEPSEEK_API_KEY=//')
curl -sS -H "Authorization: Bearer $DEEPSEEK_KEY" \
  https://api.deepseek.com/user/balance | head -c 300

# D. 直接打一发 chat 看上游回什么
curl -sS -m 20 \
  -H "Authorization: Bearer $DEEPSEEK_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"ping"}],"max_tokens":5}' \
  https://api.deepseek.com/chat/completions | head -c 500
```

---

## 3. 故障：暂时性 5xx / 超时（DeepSeek 自己的问题）

**信号**：直接 curl DeepSeek 也是 5xx 或 timeout。

**修复**：什么都别动。circuit breaker 已经接管：

- `circuit_open=true` 后，所有 chat 请求直接走本地 fallback（不再调上游）
- 冷却时间到后会半开（试一次）→ 成功就恢复

只需要：

```bash
# 看冷却时间还有多久
grep '^CIRCUIT_BREAKER_COOLDOWN_MS=' .env

# 看历史多久内会自愈（看 logs 里 circuit_closed 事件）
pm2 logs book-of-elon --nostream --lines 1000 | grep circuit_closed | tail -5
```

如果 DeepSeek 自己 30 分钟都没恢复 → 进 §5。

---

## 4. 故障：余额不足

**信号**：`/user/balance` 返回 `total_balance` < 5。

**修复**：

```bash
# 1. 立刻去充值（DeepSeek 控制台 → 财务）
#    建议每月预存 100 元，daily-report.sh 会在 < 50 时告警
echo "Visit: https://platform.deepseek.com/billing"

# 2. 充值后等 5 分钟生效
# 3. 让 circuit 强制 reset（等不及自然冷却）：
pm2 reload book-of-elon --update-env

# 4. 验证
sleep 5
curl -s http://127.0.0.1:3000/api/health | grep -A 3 '"llm"'
# 期望：circuit_open=false, status=ok
```

如果 30 天内出过 2 次余额低，把 `DAILY_TOTAL_TOKEN_BUDGET` 调更紧或加预存量。

---

## 5. 故障：DeepSeek 长时间故障（>30 分钟）

**信号**：`status.deepseek.com` 公告 incident 或直接 curl 持续不回。

**操作**：

```bash
# 1. 加大 circuit 冷却时间，避免反复试探打日志
nano .env
# 把 CIRCUIT_BREAKER_COOLDOWN_MS=60000 改成 600000（10 分钟）
pm2 reload book-of-elon --update-env

# 2. 在前端加临时公告（如果有 banner 机制；当前 v1 还没有，跳过）

# 3. 监控状态页
curl -s https://status.deepseek.com | head -200
# 或刷 X / 微博 看官方账号
```

**长期**：这次故障后评估"加备选模型"是否值得（kimi / qwen / glm-4 / 自部署）。
最小代价方案：在 `services/model-client.js` 加一个 `BACKUP_LLM_PROVIDER` 路径，DeepSeek 持续 down 5 分钟自动切。

---

## 6. 故障：API key 被禁用 / rotate

**信号**：直接 curl 返回 `401 Unauthorized` 或 `403 Forbidden`。

**修复**：

```bash
# 1. 登录 DeepSeek 控制台，确认 key 还有效
#    https://platform.deepseek.com/api_keys

# 2. 如果被禁，先在控制台看原因（违规？泄漏？）

# 3. Rotate：在 DeepSeek 控制台生成新 key，把旧 key revoke
#    不要复用旧 key，即使能恢复

# 4. 写入 .env（务必 600）
nano .env
# DEEPSEEK_API_KEY=sk-<新 key>
chmod 600 .env

# 5. reload
pm2 reload book-of-elon --update-env
sleep 5

# 6. 验证
curl -s http://127.0.0.1:3000/api/health | grep -A 3 '"llm"'
DEEPSEEK_KEY=$(grep '^DEEPSEEK_API_KEY=' .env | sed 's/^DEEPSEEK_API_KEY=//')
curl -sS -H "Authorization: Bearer $DEEPSEEK_KEY" https://api.deepseek.com/user/balance
```

**重要**：旧 key 如果已经在 git 历史里出现过，跑 `docs/runbooks/incident-cost-spike.md` §5 的 rotate 流程，并 grep history 确认彻底替换。

---

## 7. 用户体验：fallback 期间能做什么

服务端有 `services/reply-engine.js`（前端镜像版在 `web/reply-engine.js`），circuit_open 时：

- 用户提问 → 本地知识库（cards.json + book-source.json）匹配 → 返回 fallback 文案
- 文案显式标注"知识库降级回答"（保持透明）
- 不消耗 DeepSeek token，余额 0 也能服务

确认 fallback 能跑：

```bash
# 离线测一发
node tests/calibration/reply-calibration.js
ls -la tests/calibration/output-latest.md
# 期望生成 27KB+ 的 markdown
```

---

## 8. 防御演进

- [x] R-01 cost guardrails（防止单次故障被攻击者扩大）
- [ ] R-14 cron daily-report.sh 监控余额（已落本批次，余额 < 50 即告警）
- [ ] 上线 `BACKUP_LLM_PROVIDER` 自动切换（评估后再做）
- [ ] `/api/health` 暴露最近一次成功上游调用的 timestamp（前端可识别静默降级）
- [ ] 前端在 circuit_open 时显示降级 banner（用户体验提示）

---

## 9. 历史事件记录

| 日期 | 现象 | 根因 | 解决路径 | 影响时长 | 用户感知 |
|---|---|---|---|---|---|
| 2026-04 | DeepSeek 调用余额耗尽 | 攻击 + cost 防御未上 | 临时禁 key + R-01 | 数小时 | 全局降级 |

> 后续事件追加。
