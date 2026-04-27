#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════
# scripts/ops/daily-report.sh — Wave 3 R-14
# ────────────────────────────────────────────────────────────────
# 每天 09:00 跑一次（北京时间）。产出 3 段日报到
# /var/log/book-of-elon/daily-YYYY-MM-DD.log：
#   1. 服务健康快照（/api/health 全 body）
#   2. DeepSeek 余额（GET /user/balance）+ 当日 cost 利用率
#   3. admin-report.js 文本摘要（PII 脱敏）
#
# 安装：
#   chmod +x scripts/ops/daily-report.sh
#   crontab -e 加：
#     0 9 * * * /root/skill_The_book_of_Elon/scripts/ops/daily-report.sh
#
# 失败模式：任何一步失败都只是日志里一行，整体仍 exit 0，cron 不刷邮件。
# DEEPSEEK_API_KEY 从应用 .env 文件读（不重复散养）。
# ════════════════════════════════════════════════════════════════

set -uo pipefail

PROJECT_ROOT="${PROJECT_ROOT:-/root/skill_The_book_of_Elon}"
LOG_DIR="${LOG_DIR:-/var/log/book-of-elon}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
DEEPSEEK_BALANCE_URL="${DEEPSEEK_BALANCE_URL:-https://api.deepseek.com/user/balance}"

mkdir -p "$LOG_DIR" 2>/dev/null || true
DATE_TAG="$(date +%Y-%m-%d)"
TS_TAG="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
OUT="$LOG_DIR/daily-${DATE_TAG}.log"

# ───────── 读 DeepSeek key（不打印） ─────────
# 注意：用 tail -n1 而不是 head -n1。shell 风格 env 加载是"后定义覆盖前定义"，
# 万一 .env 里残留了占位符（比如紧急封禁时写的 disabled_due_to_abuse），实际生效
# 的应该是文件最后一条 — 我们要跟应用看到的值保持一致。
DEEPSEEK_API_KEY=""
DEEPSEEK_API_KEY_REASON=""
ENV_FILE="$PROJECT_ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  DEEPSEEK_API_KEY="$(grep -E '^DEEPSEEK_API_KEY=' "$ENV_FILE" 2>/dev/null | tail -n1 | sed -E 's/^DEEPSEEK_API_KEY=//; s/^"//; s/"$//')"
fi
# 占位符显式跳过（不要去敲 DeepSeek 浪费一次 401 + 误导日报）
case "$DEEPSEEK_API_KEY" in
  ""|disabled_*|placeholder*|REPLACE_ME*)
    DEEPSEEK_API_KEY_REASON="(skipped: key looks like placeholder/disabled)"
    DEEPSEEK_API_KEY=""
    ;;
esac

{
  echo "════════════════════════════════════════════════════════════════"
  echo "Book of Elon — daily report  ${DATE_TAG}  (generated ${TS_TAG})"
  echo "════════════════════════════════════════════════════════════════"
  echo ""

  # ───────── 1. 健康快照 ─────────
  echo "[1] /api/health"
  echo "─────────────"
  curl -sS --max-time 8 "$HEALTH_URL" 2>&1 || echo "(curl failed)"
  echo ""
  echo ""

  # ───────── 2. DeepSeek 余额 ─────────
  echo "[2] DeepSeek balance"
  echo "─────────────"
  if [ -n "$DEEPSEEK_API_KEY" ]; then
    BAL_BODY="$(curl -sS --max-time 8 \
      -H "Authorization: Bearer ${DEEPSEEK_API_KEY}" \
      -H "Accept: application/json" \
      "$DEEPSEEK_BALANCE_URL" 2>&1)"
    echo "$BAL_BODY"
    # 简单提取 total_balance（不依赖 jq）
    TOTAL="$(echo "$BAL_BODY" | grep -oE '"total_balance":"?[0-9.]+' | head -1 | sed -E 's/.*:"?//')"
    if [ -n "$TOTAL" ]; then
      echo ""
      echo "(parsed total_balance = ${TOTAL} CNY)"
      # 简单告警：余额 < 50 写 incident
      AWK_RESULT="$(echo "$TOTAL" | awk '{ print ($1 < 50) ? "LOW" : "OK" }')"
      if [ "$AWK_RESULT" = "LOW" ]; then
        echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] DEEPSEEK_BALANCE_LOW total=${TOTAL} CNY" \
          >> "$LOG_DIR/incident.log"
        echo ">>> WARNING: DeepSeek balance LOW (<50 CNY)"
      fi
    fi
  else
    echo "${DEEPSEEK_API_KEY_REASON:-(skipped: DEEPSEEK_API_KEY 未在 ${ENV_FILE} 中找到)}"
  fi
  echo ""
  echo ""

  # ───────── 3. admin-report.js（PII 脱敏） ─────────
  echo "[3] admin-report (db summary, PII masked)"
  echo "─────────────"
  if [ -f "$PROJECT_ROOT/scripts/tools/admin-report.js" ]; then
    cd "$PROJECT_ROOT" && node scripts/tools/admin-report.js 2>&1 || echo "(admin-report failed)"
  else
    echo "(scripts/tools/admin-report.js 不存在)"
  fi

  echo ""
  echo "════════════════════════════════════════════════════════════════"
  echo "end of report ${DATE_TAG}"
  echo "════════════════════════════════════════════════════════════════"
} >> "$OUT" 2>&1

# 保留 30 天
find "$LOG_DIR" -name 'daily-*.log' -mtime +30 -delete 2>/dev/null || true

exit 0
