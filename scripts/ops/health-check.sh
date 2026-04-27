#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
# scripts/ops/health-check.sh — Wave 3 R-14
# ────────────────────────────────────────────────────────────────
# 每分钟 cron 跑一次，curl /api/health。
#
# 行为（R-26 后细化）：
#   - HTTP 200 + status=ok + db.status=ok + llm.status ∈ {ok, idle, stale_ok}
#     → 静默退出 0（idle/stale_ok 是"暂无近时调用"的良性状态）
#   - status=degraded（LLM 上游 401/网络抖）→ log + 不计入 reload threshold
#       reload 改不了上游 key，只会刷日志；这个交给 daily-report 提醒人换 key
#   - HTTP 失败 / status=down / db.status=down → 计入 fail count，连续 3 次 reload
#   - 任何写入都进 /var/log/book-of-elon/{health,incident}.log
#
# 安装：
#   chmod +x scripts/ops/health-check.sh
#   crontab -e 加：
#     * * * * * /root/skill_The_book_of_Elon/scripts/ops/health-check.sh >/dev/null 2>&1
#
# 设计选择：
#   - 用 pure curl + grep，不依赖 jq（VPS 上不一定装）
#   - 状态 file 在 /var/run/book-of-elon/，tmpfs，重启自动清空（合理）
#   - reload 后清零计数，避免 reload 完立刻又触发第二次 reload
# ════════════════════════════════════════════════════════════════

set -uo pipefail
# 注意：故意不开 -e —— curl 失败、grep miss、reload 失败都不应该让脚本异常退出，
# 它要把所有失败都吞下来记日志，cron 才不会反复给你发邮件。

HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
APP_NAME="${APP_NAME:-book-of-elon}"
LOG_DIR="${LOG_DIR:-/var/log/book-of-elon}"
STATE_DIR="${STATE_DIR:-/var/run/book-of-elon}"
RELOAD_THRESHOLD="${RELOAD_THRESHOLD:-3}"
RELOAD_COOLDOWN_SEC="${RELOAD_COOLDOWN_SEC:-600}"   # 10 分钟内不重复 reload

mkdir -p "$LOG_DIR" "$STATE_DIR" 2>/dev/null || true
HEALTH_LOG="$LOG_DIR/health.log"
INCIDENT_LOG="$LOG_DIR/incident.log"
STATE_FILE="$STATE_DIR/health-fail-count"
LAST_RELOAD_FILE="$STATE_DIR/last-reload-ts"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log_health() { echo "[$(ts)] $1" >> "$HEALTH_LOG"; }
log_incident() { echo "[$(ts)] $1" >> "$INCIDENT_LOG"; }

# ───────── 探活 ─────────
BODY="$(curl -sS --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"
HTTP_OK=$?

# 判定 3 类：
#   green  → status=ok + db ok + llm ∈ {ok, idle, stale_ok}（不计 reload）
#   yellow → status=degraded 且 db.status=ok（LLM 漂了，记录但不 reload）
#   red    → curl 失败 / status=down / db.status=down（累计 → reload）
state="red"
if [ -n "$BODY" ]; then
  has_top_ok=0
  has_top_degraded=0
  echo "$BODY" | grep -q '"status":"ok"' && has_top_ok=1
  echo "$BODY" | grep -q '"status":"degraded"' && has_top_degraded=1
  has_db_ok=0
  echo "$BODY" | grep -q '"db":{"status":"ok"' && has_db_ok=1

  if [ "$has_top_ok" = "1" ] && [ "$has_db_ok" = "1" ]; then
    state="green"
  elif [ "$has_top_degraded" = "1" ] && [ "$has_db_ok" = "1" ]; then
    state="yellow"
  fi
fi

# ───────── green：清零 + 静默 ─────────
if [ "$state" = "green" ]; then
  echo 0 > "$STATE_FILE"
  exit 0
fi

body_excerpt="$(echo "$BODY" | tr -d '\r\n' | cut -c 1-200)"

# ───────── yellow：记 + 不计 reload threshold ─────────
if [ "$state" = "yellow" ]; then
  log_health "DEGRADED (LLM 漂了，不 reload；body=${body_excerpt})"
  # 不动 STATE_FILE — yellow 不应导致最终触发 reload
  exit 0
fi

# ───────── red：累计 + 可能 reload ─────────
prev_fails=0
[ -f "$STATE_FILE" ] && prev_fails=$(cat "$STATE_FILE" 2>/dev/null || echo 0)
fails=$((prev_fails + 1))
echo "$fails" > "$STATE_FILE"

log_health "FAIL #${fails} curl_exit=${HTTP_OK} body_excerpt=${body_excerpt:-<empty>}"

if [ "$fails" -lt "$RELOAD_THRESHOLD" ]; then
  exit 0
fi

# 检查冷却：不要在 10 分钟内反复 reload
now_epoch=$(date +%s)
last_reload=0
[ -f "$LAST_RELOAD_FILE" ] && last_reload=$(cat "$LAST_RELOAD_FILE" 2>/dev/null || echo 0)
if [ $((now_epoch - last_reload)) -lt "$RELOAD_COOLDOWN_SEC" ]; then
  log_incident "SKIP reload (within ${RELOAD_COOLDOWN_SEC}s cooldown). consecutive_fails=${fails}"
  exit 0
fi

# 触发 reload
log_incident "TRIGGER pm2 reload ${APP_NAME} after ${fails} consecutive failures"
if command -v pm2 >/dev/null 2>&1; then
  pm2 reload "$APP_NAME" --update-env >> "$INCIDENT_LOG" 2>&1 || \
    log_incident "PM2 RELOAD FAILED — manual intervention required"
else
  log_incident "pm2 not found in PATH — cannot auto-recover"
fi

echo "$now_epoch" > "$LAST_RELOAD_FILE"
echo 0 > "$STATE_FILE"

exit 0
