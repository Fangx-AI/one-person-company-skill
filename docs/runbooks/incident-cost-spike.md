# Runbook · DeepSeek 余额异常消耗（cost spike）

| | |
|---|---|
| **首次记录** | 2026-04-27 |
| **触发场景** | 检查 DeepSeek 控制台/账单时发现余额下降速度远超预期 |
| **历史事件** | 2026-04 月 3 天烧 ¥100（key 当时无防护，rate limit 仅 8 req/min/IP） |
| **当前防护** | R-01 cost guardrails（`services/cost-control.js`）已上线 2026-04-27 |

---

## 0. 一句话诊断顺序

```
看账单异常 → 看 /api/health 的 cost 段 → 看 logEvent 'cost_guardrail_triggered'
→ 看 logEvent 'upstream_request_failed' → 看 DeepSeek 控制台按 IP/时段
→ 决定：临时禁 key？降低 cap？拉黑 IP？
```

---

## 1. 现象判定

只要满足 **任一项**：

- DeepSeek 控制台余额比昨天预期多减 ¥1 以上
- `/api/health` 返回 `cost.global.utilization_pct > 80` 但日志里没看到大量正常用户活动
- 单 IP 在 access log 里 chat 请求数 > 100/小时
- 短时间内 `chat_response` 日志里同一手机号 / cookie 出现 > 50 次

→ 进入本 runbook。

---

## 2. 90 秒止血（按风险递增）

### 2.1 看一眼当前 cost 状态（10 秒）

```bash
curl -s http://127.0.0.1:3000/api/health | grep -A 8 '"cost"'
```

期望看到：

```json
"cost": {
  "date": "2026-04-27",
  "global": {
    "tokens_used": 12345,
    "tokens_budget": 2000000,
    "utilization_pct": 0.6,
    "requests_today": 87
  },
  "caps": {
    "per_ip_daily_tokens": 50000,
    "per_anon_session_daily_chats": 20
  },
  "tracked_ips": 12,
  "tracked_anon_sessions": 23
}
```

**异常信号**：
- `utilization_pct > 50` 但今天看用户数据没增长 → 有人在刷
- `tracked_ips > 100` 在低峰时段 → 多源攻击
- `tracked_anon_sessions` 比 `tracked_ips` 大太多 → cookie 在变

### 2.2 看防护是否在生效（10 秒）

```bash
pm2 logs book-of-elon --lines 500 | grep -E 'cost_guardrail_triggered|rate_limited|chat_request_rejected' | tail -50
```

如果看到大量 `cost_guardrail_triggered` 而 `utilization_pct < 100` → 是单 IP 或匿名 session 触发，正在生效，攻击被挡。
如果只看到 `rate_limited` 但 `utilization_pct` 在涨 → 攻击者切 IP 但每个 IP 频率低于 rate limit，需要看 §2.3。

### 2.3 临时降配额（30 秒，需重启）

如果发现 `cost_guardrail_triggered` 没触发但烧得快，临时把 cap 改严：

```bash
ssh 服务器
cd /root/skill_The_book_of_Elon
# 编辑 .env，把这三个值都减半
nano .env
# DAILY_TOTAL_TOKEN_BUDGET=1000000
# DAILY_TOKEN_PER_IP=20000
# DAILY_ANON_CHAT_PER_SESSION=10
pm2 reload book-of-elon --update-env
curl -s http://127.0.0.1:3000/api/health | grep -A 4 '"cost"'
```

### 2.4 终极止血：禁用 DeepSeek key（30 秒）

如果以上都没用 / 你不在电脑前没空看：

```bash
nano .env
# DEEPSEEK_API_KEY=disabled_due_to_abuse
pm2 reload book-of-elon --update-env
```

效果：服务器立刻全部走本地 fallback（用户体验降级但不会再烧钱）。
代价：登录用户聊天质量明显下降，需要尽快调查 + 恢复。
恢复：见 §5。

---

## 3. 诊断（确定攻击模式）

### 3.1 按 IP 排序 chat 请求

```bash
pm2 logs book-of-elon --nostream --lines 5000 \
  | grep '"event":"chat_response"' \
  | grep -oE '"clientIp":"[^"]+"' \
  | sort | uniq -c | sort -rn | head -20
```

**正常**：top 几个 IP 各几十次（你 + 几个真用户）。
**异常**：top IP 几百几千次 → 单源攻击。

### 3.2 按 anon session 排序

```bash
pm2 logs book-of-elon --nostream --lines 5000 \
  | grep '"event":"chat_response"' \
  | grep -oE '"sessionId":"[^"]+"' \
  | sort | uniq -c | sort -rn | head -20
```

如果 IP 分散但 anon session 集中 → cookie 在被重用（少见）
如果 IP 分散 + anon session 也分散 → 真的是分布式攻击或多账号刷

### 3.3 看 DeepSeek 控制台

登录 https://platform.deepseek.com → 调用记录：
- 按时段：判断是不是某个时间段集中
- 按模型：是不是有人在 hijack 用更贵的模型（CSO #2 已修，理论上不可能，但兜底验证）
- 单条 token：异常大的 prompt？（CSO #2 已修，所有 system prompt 服务端固定）

---

## 4. 已上的防御（R-01，2026-04-27 起）

代码：`services/cost-control.js` + `server.js handleChatRequest`

三道闸：

| 防线 | 默认值 | env var | 触发后果 |
|---|---|---|---|
| 全站每日 token 总额 | 2,000,000 token / 天 (≈¥10) | `DAILY_TOTAL_TOKEN_BUDGET` | 全站降级（200 + degraded + reason=daily_budget_exhausted） |
| 单 IP 每日 token 配额 | 50,000 token / IP / 天 | `DAILY_TOKEN_PER_IP` | 仅该 IP 降级 |
| 匿名 session 每日 chat 次数 | 20 次 / anon session / 天 | `DAILY_ANON_CHAT_PER_SESSION` | 仅该 session 降级，前端引导登录 |

输入收紧（同一波）：
- `DEEPSEEK_MAX_TOKENS` 默认 700 → **400**（单次回复上限）
- `sanitizeMessages` 单条 2500 → **800** 字符
- 历史窗口 10 → **8** 条
- 历史总字符 → **5000** 上限（超时从最旧丢）

数学：单次 LLM 调用上限 ≈ system prompt 1500 + history 5000 + 回复 400 ≈ 7000 token ≈ ¥0.035。
全站 daily 2M token ≈ 285 次完整对话 / 天。正常用户用不到 1/10。

---

## 5. 恢复 DeepSeek key（如果 §2.4 临时禁用过）

```bash
# 1. 确认攻击源已经被防住（检查最近 30 分钟日志没有新的 cost_guardrail_triggered 飙升）
pm2 logs book-of-elon --nostream --lines 1000 | grep cost_guardrail_triggered | wc -l

# 2. 在 DeepSeek 控制台轮转一个新 API key（旧的可能被记录在攻击者日志里）
#    https://platform.deepseek.com/api_keys

# 3. 把新 key 写回 .env
nano .env
# DEEPSEEK_API_KEY=sk-<新 key>
pm2 reload book-of-elon --update-env

# 4. 跑一次 smoke 验证
curl -s http://127.0.0.1:3000/api/health | grep '"llm"'
# 期望: "llm": { "status": "ok", ... }

curl -X POST http://127.0.0.1:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"测试一句"}]}' \
  -i | head -3
# 期望：HTTP 200 + 一段正常回复（不是 fallback）
```

---

## 6. 防御回归测试

每次改 cost-control 配置后跑：

```bash
npm run cost:smoke
```

期望输出：`Total: 30 passed, 0 failed`。

---

## 7. 长期项（追踪在 §7 路线图 R-14）

未做但建议尽快上：

1. **DeepSeek 余额 cron 监控**：每天拉 DeepSeek 余额 API，余额 < ¥10 时发飞书/邮件告警
2. **`/api/health` 异常时自动告警**：UptimeRobot 或自建 cron 看 `status != "ok"` 持续 2 分钟就报警
3. **每日 cost 报告**：每天 0 点把昨天的 `cost.global.tokens_used` 落到 `data/cost-history.jsonl`，便于趋势对比
4. **多实例时把 cost-control 状态共享化**：当前是内存级，重启或多实例会让 cap 失效，需要换 SQLite/Redis

---

## 8. 历史事件记录

| 日期 | 事件 | 防御演进 |
|---|---|---|
| 2026-04 | 3 天烧 ¥100，临时把 `DEEPSEEK_API_KEY=disabled_due_to_abuse` 止血 | rate limit 8/min 不够 |
| 2026-04-14 | CSO audit Finding #2：客户端可覆盖 system prompt | 修复（commit `0f2d79a`），但 cost 防御还没上 |
| 2026-04-27 | R-01 cost guardrails 上线 | 三道闸 + 输入收紧 + max_tokens 400 |
| _未来_ | … | … |
